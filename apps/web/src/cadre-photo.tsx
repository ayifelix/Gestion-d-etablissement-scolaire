import { useEffect, useRef, useState, type CSSProperties } from "react";

export type CadrePhotoItem = {
  src: string;
  lowSrc: string;
  alt: string;
  label: string;
  position?: string;
};

export function CadrePhoto({
  item,
  index,
  main = false,
  onOpen,
}: {
  item: CadrePhotoItem;
  index: number;
  main?: boolean;
  onOpen: (index: number) => void;
}) {
  const frameRef = useRef<HTMLButtonElement>(null);
  const [highLoaded, setHighLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    if (!("IntersectionObserver" in window)) {
      frame.classList.add("cadre-visible");
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          frame.classList.add("cadre-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.18 });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  const open = () => {
    if (failed) return;
    const transitionDocument = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };
    if (transitionDocument.startViewTransition) transitionDocument.startViewTransition(() => onOpen(index));
    else onOpen(index);
  };

  return (
    <button
      ref={frameRef}
      type="button"
      className={`cadre-photo${main ? " cadre-photo-main" : ""}`}
      style={{
        "--cadre-delay": `${index * 80}ms`,
        "--cadre-position": item.position ?? "50% 50%",
      } as CSSProperties}
      onClick={open}
      aria-label={`Voir en grand : ${item.label}`}
    >
      <span className="cadre-weave" aria-hidden="true" />
      {failed ? (
        <span className="cadre-fallback" role="img" aria-label={item.alt}>Image indisponible</span>
      ) : (
        <>
          <img
            className="cadre-low"
            src={item.lowSrc}
            alt=""
            width={480}
            height={320}
            loading="lazy"
            aria-hidden="true"
          />
          <img
            className={highLoaded ? "cadre-high is-loaded" : "cadre-high"}
            src={item.src}
            alt={item.alt}
            width={960}
            height={640}
            loading={main ? "eager" : "lazy"}
            fetchPriority={main ? "high" : "auto"}
            onLoad={() => setHighLoaded(true)}
            onError={() => setFailed(true)}
          />
        </>
      )}
      <span className="cadre-caption"><strong>{item.label}</strong><small>Images illustratives</small></span>
    </button>
  );
}

export function PhotoViewer({
  items,
  index,
  onClose,
  onChange,
}: {
  items: CadrePhotoItem[];
  index: number;
  onClose: () => void;
  onChange: (index: number) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchStart = useRef<number | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft") onChange((index - 1 + items.length) % items.length);
      if (event.key === "ArrowRight") onChange((index + 1) % items.length);
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button, [href], [tabindex]:not([tabindex='-1'])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKey); };
  }, [index, items.length, onClose, onChange]);

  const item = items[index];
  const move = (delta: number) => onChange((index + delta + items.length) % items.length);

  return (
    <div
      ref={dialogRef}
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={`Visionneuse photo : ${item.label}`}
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        if (touchStart.current === null) return;
        const delta = (event.changedTouches[0]?.clientX ?? touchStart.current) - touchStart.current;
        if (Math.abs(delta) > 50) move(delta > 0 ? -1 : 1);
        touchStart.current = null;
      }}
    >
      <div className="photo-viewer-bar">
        <span>{index + 1} / {items.length}</span>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Fermer la visionneuse">Fermer</button>
      </div>
      <button className="viewer-nav viewer-prev" type="button" onClick={() => move(-1)} aria-label="Photo précédente">‹</button>
      <img src={item.src} alt={item.alt} width={960} height={640} />
      <button className="viewer-nav viewer-next" type="button" onClick={() => move(1)} aria-label="Photo suivante">›</button>
      <p>{item.label}</p>
    </div>
  );
}
