"use client";
import type { ReactNode } from "react";
import { ArrowLeft, X, type LucideIcon } from "lucide-react";

/**
 * The platform's popup / window frame (same look as the wallet cards): cream paper with a stitched edge and a
 * leather header band carrying an optional back button, an icon, the title and a close button.
 * Styles: app/paper.css (pcard, pcard-head, pseg, plist / prow, pbtn-*, pfield, pnote, pswitch).
 */
export function PaperCard({
  title,
  icon: Icon,
  onClose,
  onBack,
  children,
  footer,
  size = "md",
  className = "",
  bodyClassName = "",
  closeLabel = "Close",
  headExtra,
}: {
  title: ReactNode;
  icon?: LucideIcon;
  onClose?: () => void;
  onBack?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md";
  className?: string;
  bodyClassName?: string;
  closeLabel?: string;
  headExtra?: ReactNode;
}) {
  return (
    <div className={`pcard ${size === "sm" ? "pcard-sm" : ""} ${className}`}>
      <div className="pcard-head">
        {onBack && (
          <button type="button" className="pcard-hbtn" onClick={onBack} aria-label="Back">
            <ArrowLeft size={size === "sm" ? 18 : 20} />
          </button>
        )}
        {Icon && (
          <span className="pcard-icon" aria-hidden>
            <Icon size={size === "sm" ? 18 : 20} />
          </span>
        )}
        <h2>{title}</h2>
        {headExtra}
        {onClose && (
          <button type="button" className="pcard-hbtn" onClick={onClose} aria-label={closeLabel}>
            <X size={size === "sm" ? 18 : 20} />
          </button>
        )}
      </div>
      <div className={`pcard-body ${bodyClassName}`}>{children}</div>
      {footer && <div className="pcard-foot">{footer}</div>}
    </div>
  );
}
