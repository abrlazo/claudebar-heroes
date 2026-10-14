import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bar } from '../lib/bridge';
import { pickImageFiles } from '../lib/images';
import type { AttachedImage } from '../lib/queue';

/**
 * The images attached to the composer's draft. Each file is read once and handed to main (`images:stage`), which
 * checks the bytes, keeps them and answers an id plus a thumbnail; the renderer keeps only those two. A send passes
 * the ids. Removing a chip, or leaving with an unsent draft, tells main to forget them.
 */
export interface ImageAttachments {
  items: AttachedImage[];
  /** Files still being handed to main (sending waits for them). */
  pending: number;
  /** A fixed message about the last attach, or null. */
  error: string | null;
  add: (files: File[]) => void;
  remove: (id: string) => void;
  /** Forgets the chips WITHOUT telling main: their ids went out with a send. */
  release: () => void;
  /** Removes every chip and tells main to forget the images. */
  clear: () => void;
}

export function useImageAttachments(): ImageAttachments {
  const [items, setItems] = useState<AttachedImage[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const itemsRef = useRef<AttachedImage[]>([]);
  const pendingRef = useRef(0);
  const alive = useRef(true);

  const commit = useCallback((next: AttachedImage[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const add = useCallback((files: File[]) => {
    const { files: picked, error: why } = pickImageFiles(files, itemsRef.current.length + pendingRef.current);
    setError(why);
    if (!picked.length) return;
    pendingRef.current += picked.length;
    setPending(pendingRef.current);
    void (async () => {
      for (const file of picked) {
        let message: string | null = null;
        try {
          const res = await bar.stageImage(await file.arrayBuffer());
          if (res.ok) {
            if (alive.current) commit([...itemsRef.current, { id: res.id, thumb: res.thumb }]);
            else bar.discardImages([res.id]);
          } else message = res.message;
        } catch {
          message = 'That image could not be read.';
        }
        pendingRef.current -= 1;
        if (alive.current) { setPending(pendingRef.current); if (message) setError(message); }
      }
    })();
  }, [commit]);

  const remove = useCallback((id: string) => {
    bar.discardImages([id]);
    commit(itemsRef.current.filter((i) => i.id !== id));
    setError(null);
  }, [commit]);

  const release = useCallback(() => { commit([]); setError(null); }, [commit]);

  const clear = useCallback(() => {
    if (itemsRef.current.length) bar.discardImages(itemsRef.current.map((i) => i.id));
    commit([]);
    setError(null);
  }, [commit]);

  // An unsent draft is forgotten when the composer goes away.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (itemsRef.current.length) bar.discardImages(itemsRef.current.map((i) => i.id));
    };
  }, []);

  return useMemo(() => ({ items, pending, error, add, remove, release, clear }), [items, pending, error, add, remove, release, clear]);
}

/**
 * Electron navigates to a file that is dropped anywhere outside a drop target, which would replace the app.
 * Dropping on the composer is handled there; everywhere else the drop is cancelled.
 */
export function useBlockFileDrop(): void {
  useEffect(() => {
    const stop = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); };
    window.addEventListener('dragover', stop);
    window.addEventListener('drop', stop);
    return () => {
      window.removeEventListener('dragover', stop);
      window.removeEventListener('drop', stop);
    };
  }, []);
}
