import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { api } from "./api";
import { EnTeteOfficiel, type SchoolBrandIdentity } from "./branding";

type DocumentType =
  | "CERTIFICAT_SCOLARITE"
  | "ATTESTATION_FREQUENTATION"
  | "RELEVE_NOTES"
  | "ATTESTATION_REUSSITE"
  | "DUPLICATA_BULLETIN";
type Year = { id: string; label: string };
type StudentOption = {
  id: string;
  matricule: string;
  person: { nom: string; prenoms: string };
  enrollments: Array<{ yearId: string; year: Year }>;
};
type Candidate = { id: string; period: { label: string } };
type OfficialDocument = {
  id: string;
  number: string;
  verificationToken: string;
  type: DocumentType;
  issuedAt: string;
  revokedAt: string | null;
  specimen: boolean;
  identitySnapshot: SchoolBrandIdentity;
  student: { matricule: string; person: { nom: string; prenoms: string } };
  year: { label: string };
  reportCard: { period: { label: string } } | null;
};
type Identity = SchoolBrandIdentity;

const typeLabels: Record<DocumentType, string> = {
  CERTIFICAT_SCOLARITE: "Certificat de scolarité",
  ATTESTATION_FREQUENTATION: "Attestation de fréquentation",
  RELEVE_NOTES: "Relevé de notes",
  ATTESTATION_REUSSITE: "Attestation de réussite",
  DUPLICATA_BULLETIN: "Duplicata de bulletin",
};
const reportTypes = new Set<DocumentType>(["RELEVE_NOTES", "ATTESTATION_REUSSITE", "DUPLICATA_BULLETIN"]);

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Opération indisponible. Réessayez.";
}

export function DocumentsWorkspace({ roles }: { roles: string[] }) {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState("");
  const [yearId, setYearId] = useState("");
  const [type, setType] = useState<DocumentType>("CERTIFICAT_SCOLARITE");
  const [reportCardId, setReportCardId] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [documents, setDocuments] = useState<OfficialDocument[]>([]);
  const [selectedDocument, setSelectedDocument] = useState<OfficialDocument | null>(null);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedStudent = students.find((student) => student.id === studentId) ?? null;
  const years = useMemo(() => selectedStudent
    ? [...new Map(selectedStudent.enrollments.map(({ year }) => [year.id, year])).values()]
    : [], [selectedStudent]);
  const isDirector = roles.includes("DIR");

  const loadDocuments = async () => {
    if (!studentId || !yearId) {
      setDocuments([]);
      return;
    }
    setDocuments(await api<OfficialDocument[]>(`/official-documents?studentId=${studentId}&yearId=${yearId}`));
  };

  useEffect(() => {
    let active = true;
    void Promise.all([
      api<StudentOption[]>("/students"),
      api<{ identity: Identity }>("/public/site"),
    ]).then(([studentRows, site]) => {
      if (!active) return;
      setStudents(studentRows);
      setIdentity(site.identity);
    }).catch((reason: unknown) => {
      if (active) setError(messageOf(reason));
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setReportCardId("");
    setCandidates([]);
    if (!studentId || !yearId || !reportTypes.has(type)) return;
    void api<Candidate[]>(`/official-documents/candidates?studentId=${studentId}&yearId=${yearId}`)
      .then((rows) => { if (active) setCandidates(rows); })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [studentId, yearId, type]);

  useEffect(() => {
    let active = true;
    void loadDocuments().catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [studentId, yearId]);

  useEffect(() => {
    let active = true;
    setQrDataUrl("");
    if (!selectedDocument) return;
    const url = new URL("/", window.location.origin);
    url.searchParams.set("verify", selectedDocument.verificationToken);
    void QRCode.toDataURL(url.toString(), { width: 180, margin: 1, errorCorrectionLevel: "M" })
      .then((dataUrl) => { if (active) setQrDataUrl(dataUrl); })
      .catch((reason: unknown) => { if (active) setError(messageOf(reason)); });
    return () => { active = false; };
  }, [selectedDocument]);

  const issueDocument = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const document = await api<OfficialDocument>("/official-documents", {
        method: "POST",
        body: JSON.stringify({
          studentId,
          yearId,
          type,
          ...(reportTypes.has(type) ? { reportCardId } : {}),
        }),
      });
      setSelectedDocument(document);
      await loadDocuments();
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setBusy(false);
    }
  };

  const revokeDocument = async (document: OfficialDocument) => {
    const reason = window.prompt("Motif de l'annulation (5 caractères minimum) :");
    if (!reason) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ revokedAt: string }>(`/official-documents/${document.id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      });
      if (selectedDocument?.id === document.id) {
        setSelectedDocument({ ...selectedDocument, revokedAt: result.revokedAt });
      }
      await loadDocuments();
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section>
        <p className="eyebrow">M14 · documents officiels</p>
        <h2>Générer un document</h2>
        <p className="help">Chaque document reçoit une référence unique et un QR de vérification. Les annulations restent tracées.</p>
        {error && <p className="alert" role="alert">{error}</p>}
        <form className="assessment-form" onSubmit={(event) => void issueDocument(event)}>
          <label>Élève
            <select value={studentId} onChange={(event) => {
              const next = students.find((item) => item.id === event.target.value);
              setStudentId(event.target.value);
              setYearId(next?.enrollments[0]?.yearId ?? "");
            }} required>
              <option value="">Choisir…</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.matricule} · {student.person.nom} {student.person.prenoms}</option>)}
            </select>
          </label>
          <label>Année scolaire
            <select value={yearId} onChange={(event) => setYearId(event.target.value)} required>
              <option value="">Choisir…</option>
              {years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
            </select>
          </label>
          <label>Document
            <select value={type} onChange={(event) => setType(event.target.value as DocumentType)}>
              {Object.entries(typeLabels).filter(([code]) => code !== "ATTESTATION_REUSSITE" || isDirector)
                .map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </label>
          {reportTypes.has(type) && <label>Bulletin publié
            <select value={reportCardId} onChange={(event) => setReportCardId(event.target.value)} required>
              <option value="">Choisir…</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.period.label}</option>)}
            </select>
          </label>}
          <button disabled={busy || !studentId || !yearId || (reportTypes.has(type) && !reportCardId)}>
            {busy ? "Génération…" : "Générer et préparer l'impression"}
          </button>
        </form>
        {!students.length && <p className="empty">Aucun élève inscrit n'est accessible à votre compte.</p>}
      </section>

      <section>
        <h2>Documents de l'élève</h2>
        <div className="report-list">
          {documents.map((document) => (
            <article key={document.id}>
              <strong>{document.number} · {typeLabels[document.type]}</strong>
              <span>{document.issuedAt.slice(0, 10)} · {document.revokedAt ? "Annulé" : "Authentique"}</span>
              {document.reportCard && <span>{document.reportCard.period.label}</span>}
              <button className="secondary" onClick={() => setSelectedDocument(document)}>Réimprimer</button>
              {isDirector && !document.revokedAt && <button className="danger-button" disabled={busy} onClick={() => void revokeDocument(document)}>Annuler</button>}
            </article>
          ))}
          {!documents.length && <p className="empty">Aucun document pour cet élève et cette année.</p>}
        </div>
      </section>

      {selectedDocument && (
        <div className="printable-document official-print">
          <EnTeteOfficiel
            identity={selectedDocument.identitySnapshot?.schoolName ? selectedDocument.identitySnapshot : identity}
            title={typeLabels[selectedDocument.type]}
            year={selectedDocument.year.label}
            reference={selectedDocument.number}
            qr={qrDataUrl}
          />
          {selectedDocument.specimen && <div className="specimen-watermark">SPÉCIMEN - DONNÉES FICTIVES</div>}
          <p>Il est certifié que <strong>{selectedDocument.student.person.prenoms} {selectedDocument.student.person.nom}</strong>, matricule <strong>{selectedDocument.student.matricule}</strong>, est inscrit(e) dans l'établissement.</p>
          {selectedDocument.reportCard && <p>Document établi sur la base du bulletin publié de la période : {selectedDocument.reportCard.period.label}.</p>}
          {selectedDocument.revokedAt && <p className="official-revoked">DOCUMENT ANNULÉ</p>}
          <div className="document-signatures"><span>Cachet et signature</span></div>
          <footer>{identity?.schoolMotto} · {identity?.republicMotto}</footer>
          <p className="official-issue-date">Délivré le {new Date(selectedDocument.issuedAt).toLocaleDateString("fr-FR")}</p>
        </div>
      )}
      {selectedDocument && <div className="actions"><button onClick={() => window.print()} disabled={!qrDataUrl}>Imprimer le document</button></div>}
    </>
  );
}
