import type { ReactNode } from "react";
import { API_ORIGIN } from "./api";

export type SchoolBrandIdentity = {
  schoolName: string;
  shortName?: string;
  monogram?: string;
  cycleSubtitle: string;
  ministry: string;
  regionalDirectorate: string;
  inspection: string;
  republicName?: string;
  republicMotto: string;
  schoolMotto: string;
  address?: string;
  logoUrl: string | null;
};

export function schoolLogoSource(value: string | null | undefined) {
  if (!value) return null;
  if (/^\/assets\/etablissement\/logo-(?:original|compact|64|128|256|512|1024)(?:-transparent)?\.(?:png|webp)$/.test(value)) {
    return value;
  }
  if (/^\/api\/public\/media\/[0-9a-f-]{36}(?:-(?:64|128|256|512|1024))?\.(?:png|jpg|webp)$/.test(value)) {
    return `${API_ORIGIN}${value}`;
  }
  return null;
}

export function ArmoiriesTogo({ size = "screen", className = "" }: {
  size?: "screen" | "large" | "small";
  className?: string;
}) {
  return <img
    className={`togo-arms togo-arms-${size}${className ? ` ${className}` : ""}`}
    src="/assets/officiel/armoiries-togo.png"
    alt="Armoiries de la République Togolaise"
  />;
}

export function EnTeteOfficiel({
  identity,
  title,
  year,
  reference,
  qr,
  showArms = true,
  reducedArms = false,
  children,
}: {
  identity: SchoolBrandIdentity | null;
  title?: string;
  year?: string;
  reference?: string;
  qr?: string;
  showArms?: boolean;
  reducedArms?: boolean;
  children?: ReactNode;
}) {
  const logo = schoolLogoSource(identity?.logoUrl);
  const schoolName = identity?.schoolName ?? "Établissement scolaire";
  return (
    <>
      {showArms
        ? <header className="document-identity official-letterhead">
            <div className="official-letterhead-left">
              <strong>{identity?.ministry}</strong>
              <span>{identity?.regionalDirectorate}</span>
              <span>{identity?.inspection}</span>
              <strong>{schoolName}</strong>
              {logo && <img className="official-school-logo" src={logo} alt={`Logo du ${schoolName}`} />}
            </div>
            <ArmoiriesTogo size={reducedArms ? "small" : "large"} />
            <div className="official-letterhead-right">
              <strong>{identity?.republicName ?? "République Togolaise"}</strong>
              <span>{identity?.republicMotto}</span>
            </div>
          </header>
        : <header className="document-identity reduced-letterhead">
            {logo && <img src={logo} alt={`Logo du ${schoolName}`} />}
            <strong>{schoolName}</strong>
          </header>}
      {(title || year || reference || qr || children) && (
        <div className="official-document-meta">
          <div>
            {title && <h1>{title}</h1>}
            {year && <span>Année scolaire {year}</span>}
            {reference && <span>Référence {reference}</span>}
            {children}
          </div>
          {qr && <img className="official-document-qr" src={qr} alt="QR code de vérification du document" />}
        </div>
      )}
    </>
  );
}
