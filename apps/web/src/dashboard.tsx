import React, { useEffect, useState } from "react";
import { api } from "./api";
import { EnTeteOfficiel, schoolLogoSource, type SchoolBrandIdentity } from "./branding";
import { J3Workspace } from "./j3";
import { FinanceWorkspace } from "./finance";
import { WorkloadWorkspace } from "./workload";
import { SiteContentWorkspace } from "./site-content";
import { SecurityWorkspace } from "./security";
import { DocumentsWorkspace } from "./documents";
import "./styles.css";

type Student = {
  id: string;
  matricule: string;
  civilStatusVerified: boolean;
  person: { nom: string; prenoms: string };
  enrollments: Array<{ classId: string; class?: { name: string } }>;
};
type ClassItem = { id: string; name: string; yearId: string; pathway: { level: { label: string } } };
type Teacher = { id: string; person: { nom: string; prenoms: string }; status: string };
type Subject = { id: string; label: string; code: string };
type Period = { id: string; yearId: string; label: string };
type Mark = {
  id: string;
  studentId: string;
  status: "NOTE" | "ABSENT_JUSTIFIE" | "ABSENT_NON_JUSTIFIE" | "DISPENSE" | "NON_NOTE";
  value: number | null;
  student: { matricule: string; isDemo?: boolean; person: { nom: string; prenoms: string } };
};
type Assessment = {
  id: string;
  title: string;
  date: string;
  kind: string;
  status: string;
  sheetNumber: string;
  maxScore: number;
  marks: Mark[];
  subject: Subject;
  teacher: { person: { nom: string; prenoms: string } };
};
type Issue = { code: string; message: string; assessmentId?: string };
type PrintableIdentity = SchoolBrandIdentity;

export function DashboardApp({ initialTab, onLogout }: { initialTab: string; onLogout: () => void }) {
  const [tab, setTab] = useState(initialTab);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [reportCards, setReportCards] = useState<any[]>([]);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [userPermissions, setUserPermissions] = useState<string[]>([]);
  const [schoolIdentity, setSchoolIdentity] = useState<PrintableIdentity | null>(null);
  const [printCard, setPrintCard] = useState<any>(null);
  const [printAssessment, setPrintAssessment] = useState<Assessment | null>(null);
  const [classId, setClassId] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [assessmentId, setAssessmentId] = useState("");
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [marks, setMarks] = useState<Record<string, { status: Mark["status"]; value: string }>>({});
  const [appreciationValues, setAppreciationValues] = useState<Record<string, string>>({});
  const [subjectId, setSubjectId] = useState("");
  const [assessmentKind, setAssessmentKind] = useState("DEVOIR");
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentDate, setAssessmentDate] = useState(new Date().toISOString().slice(0, 10));
  const [maxScore, setMaxScore] = useState("20");
  const [studentNom, setStudentNom] = useState("");
  const [studentPrenoms, setStudentPrenoms] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setError("");
    try {
      const currentUser = await api<any>("/me");
      const roles = currentUser.roles.map((assignment: any) => assignment.role.code as string);
      setUserRoles(roles);
      setUserPermissions(currentUser.roles.flatMap((assignment: any) =>
        assignment.role.permissions.map((item: any) => item.permission.code as string),
      ));
      const canReadStudents = roles.some((role: string) =>
        ["DIR", "CEN", "SG", "SEC", "PROF", "TIT", "VERIFICATEUR", "SUPPLEANT_VERIF", "PAR", "ELE"].includes(role),
      );
      const canReadClasses = roles.some((role: string) =>
        ["DIR", "CEN", "SG", "SEC", "PROF", "TIT", "VERIFICATEUR", "SUPPLEANT_VERIF", "PAR"].includes(role),
      );
      const canReadTeachers = roles.some((role: string) => ["DIR", "CEN", "SEC", "PROF", "TIT"].includes(role));
      const canReadSubjects = roles.some((role: string) => ["DIR", "CEN", "SEC", "PROF", "TIT"].includes(role));
      const [studentRows, classRows, teacherRows, subjectRows, yearRows] = await Promise.all([
        canReadStudents ? api<Student[]>("/students") : Promise.resolve([]),
        canReadClasses ? api<ClassItem[]>("/classes") : Promise.resolve([]),
        canReadTeachers ? api<Teacher[]>("/teachers") : Promise.resolve([]),
        canReadSubjects ? api<Subject[]>("/subjects") : Promise.resolve([]),
        api<any[]>("/years"),
      ]);
      setStudents(studentRows);
      setClasses(classRows);
      setTeachers(teacherRows);
      setSubjects(subjectRows);
      const allPeriods = yearRows.flatMap((year) => year.periods as Period[]);
      setPeriods(allPeriods);
      const defaultClass = classRows[0];
      if (!classId && defaultClass) setClassId(defaultClass.id);
      if (!periodId && allPeriods.length) setPeriodId(allPeriods[0].id);
      if (!subjectId && subjectRows.length) setSubjectId(subjectRows[0].id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chargement impossible");
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    void api<{ identity: PrintableIdentity }>("/public/site")
      .then((site) => setSchoolIdentity(site.identity))
      .catch(() => {
        try {
          const cached = JSON.parse(localStorage.getItem("public-site-cache-v1") ?? "null");
          if (cached?.site?.identity?.schoolName) setSchoolIdentity(cached.site.identity as PrintableIdentity);
        } catch {
          setSchoolIdentity(null);
        }
      });
  }, []);

  const loadAssessments = async () => {
    if (!classId || !periodId) return;
    setBusy(true);
    setError("");
    try {
      const rows = await api<Assessment[]>(`/assessments?classId=${encodeURIComponent(classId)}&periodId=${encodeURIComponent(periodId)}`);
      setAssessments(rows);
      const target = rows.find((item) => item.id === assessmentId) ?? rows[0];
      if (target) {
        setAssessmentId(target.id);
        setMarks(Object.fromEntries(target.marks.map((mark) => [
          mark.studentId,
          { status: mark.status, value: mark.value === null ? "" : String(mark.value) },
        ])));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Évaluations indisponibles");
    } finally {
      setBusy(false);
    }
  };

  const selectedAssessment = assessments.find((assessment) => assessment.id === assessmentId);
  const selectedClass = classes.find((item) => item.id === classId);
  const studentsInClass = students.filter((student) =>
    student.enrollments.some((enrollment) => enrollment.classId === classId),
  );

  const run = async (action: () => Promise<void>, successMessage: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "L'opération a échoué");
    } finally {
      setBusy(false);
    }
  };

  const createStudent = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await api("/students", { method: "POST", body: JSON.stringify({ nom: studentNom, prenoms: studentPrenoms }) });
      setStudentNom("");
      setStudentPrenoms("");
      await refresh();
    }, "Élève enregistré.");
  };

  const createAssessment = (event: React.FormEvent) => {
    event.preventDefault();
    void run(async () => {
      const created = await api<Assessment>("/assessments", {
        method: "POST",
        body: JSON.stringify({ classId, subjectId, periodId, kind: assessmentKind, title: assessmentTitle, date: assessmentDate, maxScore: Number(maxScore) }),
      });
      setAssessmentTitle("");
      setAssessmentId(created.id);
      await loadAssessments();
    }, "Feuille de notes créée.");
  };

  const saveMarks = () => {
    if (!selectedAssessment) return;
    void run(async () => {
      await api(`/assessments/${selectedAssessment.id}/marks`, {
        method: "PUT",
        body: JSON.stringify({
          marks: selectedAssessment.marks.map((mark) => ({
            studentId: mark.studentId,
            status: marks[mark.studentId]?.status ?? "NON_NOTE",
            ...(marks[mark.studentId]?.status === "NOTE" && marks[mark.studentId]?.value !== ""
              ? { value: Number(marks[mark.studentId].value) }
              : {}),
          })),
        }),
      });
      await loadAssessments();
    }, "Saisie enregistrée.");
  };

  const submitAssessment = () => {
    if (!selectedAssessment) return;
    void run(async () => {
      await api(`/assessments/${selectedAssessment.id}/marks`, {
        method: "PUT",
        body: JSON.stringify({
          marks: selectedAssessment.marks.map((mark) => ({
            studentId: mark.studentId,
            status: marks[mark.studentId]?.status ?? "NON_NOTE",
            ...(marks[mark.studentId]?.status === "NOTE" && marks[mark.studentId]?.value !== ""
              ? { value: Number(marks[mark.studentId].value) }
              : {}),
          })),
        }),
      });
      await api(`/assessments/${selectedAssessment.id}/submit`, { method: "POST", body: "{}" });
      await loadAssessments();
    }, "Feuille soumise au vérificateur.");
  };

  const runChecklist = () => void run(async () => {
    const result = await api<{ issues: Issue[] }>(`/reports/checklist?classId=${classId}&periodId=${periodId}`);
    setIssues(result.issues);
  }, "Checklist actualisée.");

  const loadReportCards = () => void run(async () => {
    const result = await api<any[]>(`/report-cards?classId=${classId}&periodId=${periodId}`);
    setReportCards(result);
  }, "Bulletins actualisés.");

  const hasRole = (...codes: string[]) => codes.some((code) => userRoles.includes(code));
  const identityLogo = schoolLogoSource(schoolIdentity?.logoUrl);
  const nav = [
    "tableau de bord",
    "sécurité",
    ...(hasRole("DIR", "CEN", "SG", "SEC", "PROF", "TIT", "PAR", "ELE") ? ["élèves"] : []),
    ...(hasRole("DIR", "CEN", "SG", "SEC", "PROF", "TIT", "VERIFICATEUR", "SUPPLEANT_VERIF") ? ["classes"] : []),
    ...(hasRole("DIR", "CEN", "SEC", "PROF", "TIT") ? ["personnel"] : []),
    ...(hasRole("PROF") ? ["notes"] : []),
    ...(hasRole("SEC", "CEN", "VERIFICATEUR", "SUPPLEANT_VERIF") ? ["vérification"] : []),
    ...(hasRole("DIR", "CEN", "TIT") ? ["bulletins"] : []),
    ...(hasRole("TIT") ? ["ma classe"] : []),
    ...(hasRole("DIR", "CEN", "SG", "SEC", "PROF", "TIT", "PAR") ? ["pédagogie"] : []),
    ...(hasRole("DIR", "CEN", "PROF", "TIT") ? ["charge horaire"] : []),
    ...(hasRole("DIR", "ECO") ? ["finances"] : []),
    ...(hasRole("DIR", "SEC") ? ["documents"] : []),
    ...(userPermissions.includes("site.gerer_contenu") ? ["contenu de l'accueil"] : []),
    ...(userPermissions.includes("etablissement.gerer_identite") ? ["identité de l'établissement"] : []),
  ];

  return (
    <div className="shell">
      <aside>
        <div className="logo">{identityLogo
          ? <img src={identityLogo} alt={`Logo du ${schoolIdentity?.schoolName ?? "Lycée Akonda Gnaweme"}`} />
          : schoolIdentity?.monogram ?? "AG"}</div>
        <h2>{schoolIdentity?.shortName || schoolIdentity?.schoolName || "Gestion scolaire"}</h2>
        <nav aria-label="Navigation principale">
          {nav.map((item) => (
            <button className={tab === item ? "active" : ""} key={item} onClick={() => setTab(item)}>{item}</button>
          ))}
        </nav>
        <button className="logout" onClick={() => { localStorage.removeItem("token"); onLogout(); }}>Déconnexion</button>
      </aside>

      <main>
        <header>
          <div><span>{schoolIdentity?.schoolName || "Espace scolaire"} · {selectedClass?.name ?? "Établissement"}</span><h1>{tab}</h1></div>
          <div className="avatar" aria-label="Utilisateur connecté">É</div>
        </header>
        <div className="page-content">
          {error && <div className="alert" role="alert">{error}</div>}
          {notice && <div className="notice" role="status">{notice}</div>}

          {tab === "pédagogie" && <J3Workspace classes={classes} teachers={teachers} subjects={subjects} roles={userRoles} />}
          {tab === "finances" && <FinanceWorkspace roles={userRoles} />}
          {tab === "charge horaire" && <WorkloadWorkspace roles={userRoles} />}
          {tab === "contenu de l'accueil" && <SiteContentWorkspace />}
          {tab === "identité de l'établissement" && <SiteContentWorkspace mode="identity" />}
          {tab === "sécurité" && <SecurityWorkspace />}

          {tab === "tableau de bord" && (
            <section>
              <p className="eyebrow">Aujourd'hui · espace académique</p>
              {hasRole("ADM") && <div className="checklist"><strong>Administration technique</strong><p>Ce compte ne dispose d'aucun accès aux dossiers des élèves, aux notes ou aux finances.</p></div>}
              <h2>Bonjour, que souhaitez-vous faire ?</h2>
              <div className="metrics">
                <article><span>Élèves</span><strong>{students.length}</strong></article>
                <article><span>Classes</span><strong>{classes.length}</strong></article>
                <article><span>Personnel enseignant</span><strong>{teachers.length}</strong></article>
                <article><span>Feuilles de notes</span><strong>{assessments.length}</strong></article>
              </div>
              <div className="quick-actions">
                <button onClick={() => setTab("notes")}>Saisir des notes <b>→</b></button>
                <button onClick={() => { setTab("vérification"); void loadAssessments(); }}>Vérifier une feuille <b>→</b></button>
                <button onClick={() => setTab("bulletins")}>Préparer les bulletins <b>→</b></button>
              </div>
            </section>
          )}

          {tab === "élèves" && (
            <section>
              <div className="toolbar">
                <div><p className="eyebrow">M2 · dossier scolaire</p><h2>Élèves <small>{students.length}</small></h2></div>
                <form onSubmit={createStudent} className="quick-form">
                  <input aria-label="Nom de famille" placeholder="Nom" value={studentNom} onChange={(event) => setStudentNom(event.target.value)} required />
                  <input aria-label="Prénoms" placeholder="Prénoms" value={studentPrenoms} onChange={(event) => setStudentPrenoms(event.target.value)} required />
                  <button disabled={busy} type="submit">Créer l'élève</button>
                </form>
              </div>
              <div className="table">
                <div className="table-head"><span>Matricule</span><span>Nom</span><span>Classe</span><span>État civil</span></div>
                {students.map((student) => (
                  <div className="table-row" key={student.id}>
                    <span>{student.matricule}</span><strong>{student.person.nom} {student.person.prenoms}</strong>
                    <span>{student.enrollments[0]?.class?.name ?? "Non inscrit"}</span>
                    <span className={student.civilStatusVerified ? "badge valid" : "badge"}>{student.civilStatusVerified ? "Vérifié" : "À vérifier"}</span>
                  </div>
                ))}
                {!students.length && <p className="empty">Aucun élève enregistré.</p>}
              </div>
            </section>
          )}

          {tab === "classes" && (
            <section><p className="eyebrow">M1 · structure annuelle</p><h2>Classes <small>{classes.length}</small></h2>
              <div className="class-list">{classes.map((item) => <article key={item.id}><span>{item.pathway.level.label}</span><h3>{item.name}</h3><button onClick={() => { setClassId(item.id); setTab("notes"); }}>Ouvrir la classe →</button></article>)}</div>
              {!classes.length && <p className="empty">Aucune classe configurée pour cette année.</p>}
            </section>
          )}

          {tab === "personnel" && (
            <section><p className="eyebrow">M3 · équipe éducative</p><h2>Personnel <small>{teachers.length}</small></h2>
              <div className="table">
                <div className="table-head"><span>Matricule</span><span>Nom</span><span>Statut</span><span>Affectations</span></div>
                {teachers.map((teacher) => <div className="table-row" key={teacher.id}><span>—</span><strong>{teacher.person.nom} {teacher.person.prenoms}</strong><span>{teacher.status}</span><span>—</span></div>)}
              </div>
            </section>
          )}

          {tab === "documents" && <DocumentsWorkspace roles={userRoles} />}

          {(tab === "notes" || tab === "vérification" || tab === "bulletins" || tab === "ma classe") && (
            <section>
              <div className="toolbar">
                <div><p className="eyebrow">M4–M6 · {tab}</p><h2>{tab === "ma classe" ? "Espace titulaire" : tab}</h2></div>
                <div className="filters">
                  <label>Classe<select value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">Choisir…</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <label>Période<select value={periodId} onChange={(event) => setPeriodId(event.target.value)}><option value="">Choisir…</option>{periods.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                  <button className="secondary" onClick={() => void loadAssessments()} disabled={busy}>Actualiser</button>
                </div>
              </div>

              {tab === "notes" && (
                <>
                  <form className="assessment-form" onSubmit={createAssessment}>
                    <label>Matière<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required>{subjects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                    <label>Type<select value={assessmentKind} onChange={(event) => setAssessmentKind(event.target.value)}><option value="INTERROGATION">Interrogation</option><option value="DEVOIR">Devoir</option><option value="COMPOSITION">Composition</option></select></label>
                    <label>Intitulé<input value={assessmentTitle} onChange={(event) => setAssessmentTitle(event.target.value)} required /></label>
                    <label>Date<input type="date" value={assessmentDate} onChange={(event) => setAssessmentDate(event.target.value)} required /></label>
                    <label>Barème<input type="number" min="0.01" step="0.01" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} required /></label>
                    <button disabled={busy || !classId || !periodId}>Créer la feuille</button>
                  </form>
                  <div className="assessment-list">{assessments.map((item) => <button className={assessmentId === item.id ? "selected" : ""} key={item.id} onClick={() => { setAssessmentId(item.id); setMarks(Object.fromEntries(item.marks.map((mark) => [mark.studentId, { status: mark.status, value: mark.value === null ? "" : String(mark.value) }]))); }}>{item.title} · {item.subject.label} · {item.status}</button>)}</div>
                  {selectedAssessment && (
                    <>
                      <p className="paper-id">Feuille {selectedAssessment.sheetNumber} · barème {selectedAssessment.maxScore} · QR {selectedAssessment.id}</p>
                      <div className="table marks-table">
                        <div className="table-head"><span>Matricule</span><span>Élève</span><span>Statut</span><span>Note / {selectedAssessment.maxScore}</span></div>
                        {selectedAssessment.marks.map((mark) => (
                          <div className="table-row" key={mark.id}>
                            <span>{mark.student.matricule}</span><strong>{mark.student.person.nom} {mark.student.person.prenoms}</strong>
                            <select aria-label={`Statut ${mark.student.person.nom}`} value={marks[mark.studentId]?.status ?? mark.status} onChange={(event) => setMarks({ ...marks, [mark.studentId]: { status: event.target.value as Mark["status"], value: "" } })}>
                              <option value="NON_NOTE">À saisir</option><option value="NOTE">Note</option><option value="ABSENT_JUSTIFIE">Absent justifié</option><option value="ABSENT_NON_JUSTIFIE">Absent non justifié</option><option value="DISPENSE">Dispensé</option>
                            </select>
                            <input aria-label={`Note ${mark.student.person.nom}`} type="number" min="0" max={selectedAssessment.maxScore} step="0.01" disabled={(marks[mark.studentId]?.status ?? mark.status) !== "NOTE"} value={marks[mark.studentId]?.value ?? (mark.value === null ? "" : String(mark.value))} onChange={(event) => setMarks({ ...marks, [mark.studentId]: { status: "NOTE", value: event.target.value } })} />
                          </div>
                        ))}
                      </div>
                      <div className="actions">
                        <button className="secondary" onClick={saveMarks} disabled={busy || selectedAssessment.status === "SOUMISE" || selectedAssessment.status === "VALIDEE"}>Enregistrer le brouillon</button>
                        <button onClick={submitAssessment} disabled={busy || selectedAssessment.status === "SOUMISE" || selectedAssessment.status === "VALIDEE"}>Soumettre la feuille</button>
                        <button className="secondary" onClick={() => { setPrintCard(null); setPrintAssessment(selectedAssessment); window.setTimeout(() => window.print(), 100); }}>Imprimer la feuille</button>
                      </div>
                      <p className="help">Une absence n'est pas transformée en zéro. Après soumission, la feuille ne peut plus être modifiée directement.</p>
                    </>
                  )}
                  {!assessments.length && <p className="empty">Créez une feuille pour commencer la saisie des notes.</p>}
                </>
              )}

              {tab === "vérification" && (
                <div className="table">
                  <div className="table-head"><span>Feuille / élève</span><span>Note</span><span>Vérification papier</span><span>Statut</span></div>
                  {assessments.filter((item) => item.status === "SOUMISE").map((assessment) => (
                    <React.Fragment key={assessment.id}>
                      {assessment.marks.map((mark) => (
                        <div className="table-row" key={mark.id}>
                          <strong>{assessment.title} · {mark.student.person.nom} {mark.student.person.prenoms}</strong>
                          <span>{mark.status === "NOTE" ? `${mark.value} / ${assessment.maxScore}` : mark.status.replaceAll("_", " ").toLowerCase()}</span>
                          <label className="check"><input type="checkbox" checked={Boolean(checked[mark.id])} onChange={(event) => setChecked({ ...checked, [mark.id]: event.target.checked })} />Vérifiée sur papier</label>
                          <span className="badge pending">À vérifier</span>
                        </div>
                      ))}
                      <div className="actions">
                        <button onClick={() => void run(async () => {
                          const markIds = assessment.marks.filter((mark) => checked[mark.id]).map((mark) => mark.id);
                          if (markIds.length) await api(`/assessments/${assessment.id}/checks`, { method: "PUT", body: JSON.stringify({ markIds }) });
                          await api(`/assessments/${assessment.id}/verify`, { method: "POST", body: "{}" });
                          await loadAssessments();
                        }, "Feuille vérifiée et verrouillée.")} disabled={busy || assessment.marks.some((mark) => !checked[mark.id])}>Valider toutes les lignes</button>
                        <button className="danger-button" onClick={() => {
                          const comment = window.prompt("Motif du renvoi au professeur :");
                          if (comment) void run(async () => {
                            await api(`/assessments/${assessment.id}/return`, { method: "POST", body: JSON.stringify({ comment }) });
                            await loadAssessments();
                          }, "Feuille renvoyée avec le motif.");
                        }}>Renvoyer au professeur</button>
                      </div>
                    </React.Fragment>
                  ))}
                  {!assessments.some((item) => item.status === "SOUMISE") && <p className="empty">Aucune feuille en attente de vérification.</p>}
                </div>
              )}

              {tab === "bulletins" && (
                <>
                  <div className="actions">
                    <button className="secondary" onClick={runChecklist} disabled={busy}>Vérifier la checklist</button>
                    <button onClick={() => void run(async () => {
                      const result = await api<{ generated: number }>("/report-cards/generate", { method: "POST", body: JSON.stringify({ classId, periodId }) });
                      setNotice(`${result.generated} bulletin(s) figé(s) en brouillon.`);
                      await loadReportCards();
                    }, "Génération terminée.")} disabled={busy || issues.length > 0}>Générer les brouillons</button>
                    <button className="secondary" onClick={loadReportCards} disabled={busy}>Afficher les bulletins</button>
                  </div>
                  <div className="checklist">
                    <h3>Contrôles préalables</h3>
                    {issues.length ? issues.map((issue, index) => <p className="checklist-item" key={`${issue.code}-${index}`}>× {issue.message}</p>) : <p className="checklist-ok">✓ Aucune anomalie détectée (actualisez la checklist).</p>}
                  </div>
                  <div className="report-list">{reportCards.map((card) => <article key={card.id}><strong>{card.student.person.nom} {card.student.person.prenoms}</strong><span>{card.period.label} · {card.status}</span><button className="secondary" onClick={() => { setPrintAssessment(null); setPrintCard(card); window.setTimeout(() => window.print(), 100); }}>Imprimer le bulletin</button><button onClick={() => void run(async () => { await api(`/report-cards/${card.id}/approve`, { method: "POST", body: "{}" }); await loadReportCards(); }, "Bulletin validé et figé.")}>Valider et figer</button></article>)}</div>
                </>
              )}

              {tab === "ma classe" && (
                <div className="table">
                  <div className="table-head"><span>Matricule</span><span>Élève</span><span>Appréciation générale</span><span>Conseil</span></div>
                  {studentsInClass.map((student) => (
                    <div className="table-row" key={student.id}>
                      <span>{student.matricule}</span><strong>{student.person.nom} {student.person.prenoms}</strong>
                      <input aria-label={`Appréciation ${student.person.nom}`} value={appreciationValues[student.id] ?? ""} onChange={(event) => setAppreciationValues({ ...appreciationValues, [student.id]: event.target.value })} />
                      <span>—</span>
                    </div>
                  ))}
                  {!!studentsInClass.length && <button onClick={() => void run(async () => {
                    await api(`/classes/${classId}/appreciations`, { method: "PUT", body: JSON.stringify({
                      yearId: selectedClass?.yearId,
                      periodId,
                      entries: studentsInClass.map((student) => ({ studentId: student.id, text: appreciationValues[student.id] ?? "" })),
                    }) });
                  }, "Appréciations enregistrées.")} disabled={busy}>Enregistrer les appréciations</button>}
                  {!studentsInClass.length && <p className="empty">Aucun élève actif dans cette classe.</p>}
                </div>
              )}
            </section>
          )}
        </div>
        {printAssessment && <div className="printable-document">
          <EnTeteOfficiel identity={schoolIdentity} title="Feuille de notes" showArms={false} />
          {printAssessment.marks.some((mark) => mark.student.isDemo) &&
            <div className="specimen-watermark">SPÉCIMEN - DONNÉES FICTIVES</div>}
          <p>{printAssessment.subject.label} · {printAssessment.title} · {printAssessment.date.slice(0, 10)} · Barème {printAssessment.maxScore}</p>
          <table><thead><tr><th>Matricule</th><th>Élève</th><th>Statut</th><th>Note</th></tr></thead>
            <tbody>{printAssessment.marks.map((mark) => {
              const current = marks[mark.studentId];
              const status = current?.status ?? mark.status;
              const value = current?.value ?? (mark.value === null ? "" : String(mark.value));
              return <tr key={mark.id}><td>{mark.student.matricule}</td><td>{mark.student.person.nom} {mark.student.person.prenoms}</td><td>{status.replaceAll("_", " ")}</td><td>{status === "NOTE" ? value : "—"}</td></tr>;
            })}</tbody>
          </table>
          <div className="document-signatures"><span>Signature de l'enseignant</span><span>Visa de vérification</span></div>
          <footer>{schoolIdentity?.schoolMotto} · {schoolIdentity?.republicMotto}</footer>
        </div>}
        {printCard && <div className="printable-document">
          <EnTeteOfficiel
            identity={printCard.snapshot?.schoolIdentity ? { ...schoolIdentity, ...printCard.snapshot.schoolIdentity } : schoolIdentity}
            title="Bulletin scolaire"
            year={printCard.year?.label}
          />
          {printCard.snapshot?.isSpecimen && <div className="specimen-watermark">SPÉCIMEN - DONNÉES FICTIVES</div>}
          <p>{printCard.student.person.nom} {printCard.student.person.prenoms} · {printCard.student.matricule}</p>
          <p>{printCard.class?.name ?? selectedClass?.name ?? ""} · {printCard.period.label}</p>
          <table><thead><tr><th>Matière</th><th>Coefficient</th><th>Moyenne</th><th>Rang</th></tr></thead>
            <tbody>{(printCard.snapshot?.subjects ?? []).map((subject: any) => (
              <tr key={subject.subjectId}><td>{subject.label}</td><td>{subject.coefficient}</td><td>{subject.average ?? "Non évalué"}</td><td>{subject.rank ?? "—"}</td></tr>
            ))}</tbody>
          </table>
          <p className="report-average">Moyenne générale : {printCard.snapshot?.average ?? "Non évaluée"} · Rang : {printCard.snapshot?.rank ?? "—"}</p>
          <p>{printCard.snapshot?.appreciation ?? ""}</p>
          <div className="document-signatures"><span>Le titulaire</span><span>La direction</span></div>
          <footer>{printCard.snapshot?.schoolIdentity?.schoolMotto ?? schoolIdentity?.schoolMotto} · {printCard.snapshot?.schoolIdentity?.republicMotto ?? schoolIdentity?.republicMotto}</footer>
        </div>}
      </main>
      <footer className="app-footer">{schoolIdentity?.schoolName || "Établissement scolaire"}{schoolIdentity?.schoolMotto ? ` · ${schoolIdentity.schoolMotto}` : ""}</footer>
    </div>
  );
}
