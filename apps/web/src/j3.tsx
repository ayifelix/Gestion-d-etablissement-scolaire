import React, { useEffect, useState } from "react";
import { api } from "./api";

type ClassItem = { id: string; name: string; yearId: string; pathway?: { level?: { code?: string; label?: string } } };
type Teacher = { id: string; person: { nom: string; prenoms: string } };
type Subject = { id: string; label: string };
type Student = { id: string; matricule: string; person: { nom: string; prenoms: string }; enrollments: Array<{ classId: string }> };
type Choice = "D" | "C" | "A4";
type AttendanceRow = {
  studentId: string;
  student: { matricule: string; person: { nom: string; prenoms: string } };
  status: "PRESENT" | "ABSENT" | "RETARD" | "EXCUSE";
  minutesLate: number | null;
  justification: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const choiceLabels: Record<Choice, string> = { D: "2nde / 1ère D", C: "2nde / 1ère C", A4: "2nde / 1ère A4" };
const formatMinute = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function J3Workspace({ classes, teachers, subjects, roles }: {
  classes: ClassItem[];
  teachers: Teacher[];
  subjects: Subject[];
  roles: string[];
}) {
  const [page, setPage] = useState(
    roles.includes("SG") ? "appel" :
      roles.includes("PAR") && !roles.some((role) => ["DIR", "CEN", "SEC", "TIT", "PROF"].includes(role)) ||
        roles.includes("SEC") && !roles.some((role) => ["DIR", "CEN", "SG", "PROF", "TIT"].includes(role))
        ? "orientation" : "emploi",
  );
  const [classId, setClassId] = useState(classes[0]?.id ?? "");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<any[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [attendanceDate, setAttendanceDate] = useState(today());
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<any>(null);
  const [textbook, setTextbook] = useState<any[]>([]);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [meetings, setMeetings] = useState<any[]>([]);
  const [meetingId, setMeetingId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [slotLabel, setSlotLabel] = useState("");
  const [slotWeekday, setSlotWeekday] = useState("1");
  const [slotStart, setSlotStart] = useState("08:00");
  const [slotEnd, setSlotEnd] = useState("08:55");
  const [sessionForm, setSessionForm] = useState({ subjectId: "", teacherId: "", roomId: "", slotId: "", dateStart: "", dateEnd: "" });
  const [lessonForm, setLessonForm] = useState({ subjectId: "", date: today(), chapter: "", content: "", homework: "", courseHeld: true });

  const act = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Opération impossible");
    } finally {
      setBusy(false);
    }
  };

  const loadSlotsAndRooms = async () => {
    const [slotRows, roomRows] = await Promise.all([api<any[]>("/timetable/slots"), api<any[]>("/rooms")]);
    setSlots(slotRows);
    setRooms(roomRows);
    setSessionForm((previous) => ({
      ...previous,
      slotId: previous.slotId || slotRows[0]?.id || "",
      roomId: previous.roomId || roomRows[0]?.id || "",
      subjectId: previous.subjectId || subjects[0]?.id || "",
      teacherId: previous.teacherId || teachers[0]?.id || "",
    }));
  };

  const loadSessions = async () => {
    if (!classId) return;
    setSessions(await api<any[]>(`/timetable?classId=${encodeURIComponent(classId)}`));
  };

  const loadAttendance = async () => {
    if (!classId) return;
    const result = await api<{ entries: AttendanceRow[] }>(`/attendance?classId=${encodeURIComponent(classId)}&date=${attendanceDate}`);
    setAttendance(result.entries);
  };

  const loadAttendanceSummary = async () => {
    if (!roles.some((role) => ["DIR", "CEN", "SG"].includes(role))) return;
    setAttendanceSummary(await api<any>(`/attendance/summary?date=${attendanceDate}`));
  };

  const loadTextbook = async () => {
    if (!classId) return;
    setTextbook(await api<any[]>(`/textbook?classId=${encodeURIComponent(classId)}`));
  };

  const loadCampaigns = async () => {
    if (!classId) return;
    const rows = await api<any[]>(`/orientation/campaigns?classId=${encodeURIComponent(classId)}`);
    setCampaigns(rows);
    const selected = rows.find((item) => item.id === campaignId) ?? rows[0];
    setCampaignId(selected?.id ?? "");
  };

  const loadMeetings = async () => {
    if (!classId) return;
    const rows = await api<any[]>(`/council-meetings?classId=${encodeURIComponent(classId)}`);
    setMeetings(rows);
    const selected = rows.find((item) => item.id === meetingId) ?? rows[0];
    setMeetingId(selected?.id ?? "");
  };

  useEffect(() => {
    if (!roles.some((role) => ["DIR", "CEN", "SG", "PROF", "TIT"].includes(role))) return;
    void loadSlotsAndRooms().catch((reason) => setError(reason instanceof Error ? reason.message : "Chargement impossible"));
  }, []);

  useEffect(() => {
    if (!classId) return;
    if (page === "emploi") void loadSessions().catch((reason) => setError(reason instanceof Error ? reason.message : "Planning indisponible"));
    if (page === "appel") {
      void loadAttendance().catch((reason) => setError(reason instanceof Error ? reason.message : "Appel indisponible"));
      void loadAttendanceSummary().catch((reason) => setError(reason instanceof Error ? reason.message : "Synthèse des appels indisponible"));
    }
    if (page === "cahier") void loadTextbook().catch((reason) => setError(reason instanceof Error ? reason.message : "Cahier indisponible"));
    if (page === "orientation") void loadCampaigns().catch((reason) => setError(reason instanceof Error ? reason.message : "Campagne indisponible"));
    if (page === "conseil") void loadMeetings().catch((reason) => setError(reason instanceof Error ? reason.message : "Conseil indisponible"));
  }, [page, classId]);

  const selectedCampaign = campaigns.find((campaign) => campaign.id === campaignId);
  const selectedMeeting = meetings.find((meeting) => meeting.id === meetingId);
  const allowedOrientationChoices: Choice[] = classes.find((item) => item.id === classId)?.pathway?.level?.code === "3E"
    ? ["D", "A4"]
    : ["D", "C", "A4"];
  const allowManagement = roles.some((role) => ["DIR", "CEN"].includes(role));
  const allowTextbook = roles.includes("PROF");

  return (
    <section>
      <p className="eyebrow">J3 · pédagogie et vie scolaire</p>
      <div className="toolbar">
        <h2>{page === "appel" ? "Appel et présences" : page === "emploi" ? "Emploi du temps" : page === "orientation" ? "Orientation" : page === "conseil" ? "Conseil de classe" : "Cahier de textes"}</h2>
        <div className="filters">
          <label>Classe<select value={classId} onChange={(event) => setClassId(event.target.value)}><option value="">Choisir…</option>{classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {page === "appel" && <label>Date<input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} /></label>}
        </div>
      </div>
      {error && <div className="alert" role="alert">{error}</div>}
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="j3-tabs">
        {[
          ["emploi", "Emploi du temps", ["DIR", "CEN", "SG", "PROF", "TIT"]],
          ["appel", "Appel", ["DIR", "CEN", "SG", "PROF", "TIT"]],
          ["orientation", "Orientation", ["DIR", "CEN", "SEC", "TIT", "PAR"]],
          ["conseil", "Conseil", ["DIR", "CEN", "TIT"]],
          ["cahier", "Cahier de textes", ["DIR", "CEN", "PROF", "TIT"]],
          ["discipline", "Discipline et suivi", ["DIR", "CEN", "SG", "PROF", "TIT"]],
        ].filter(([, , allowed]) => (allowed as string[]).some((role) => roles.includes(role)))
          .map(([id, label]) => <button key={id as string} className={page === id ? "active" : ""} onClick={() => setPage(id as string)}>{label}</button>)}
      </div>

      {page === "emploi" && (
        <>
          {allowManagement && (
            <>
              <form className="assessment-form" onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await api("/rooms", { method: "POST", body: JSON.stringify({ name: roomName, capacity: 50, type: "CLASSE" }) });
                  setRoomName("");
                  await loadSlotsAndRooms();
                }, "Salle enregistrée.");
              }}>
                <label>Nouvelle salle<input value={roomName} onChange={(event) => setRoomName(event.target.value)} required /></label>
                <button disabled={busy}>Ajouter la salle</button>
              </form>
              <form className="assessment-form" onSubmit={(event) => {
                event.preventDefault();
                const toMinute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
                void act(async () => {
                  await api("/timetable/slots", { method: "POST", body: JSON.stringify({ label: slotLabel, weekday: Number(slotWeekday), startMinute: toMinute(slotStart), endMinute: toMinute(slotEnd) }) });
                  setSlotLabel("");
                  await loadSlotsAndRooms();
                }, "Créneau enregistré.");
              }}>
                <label>Créneau<input value={slotLabel} onChange={(event) => setSlotLabel(event.target.value)} placeholder="08h00–08h55" required /></label>
                <label>Jour<select value={slotWeekday} onChange={(event) => setSlotWeekday(event.target.value)}>{["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"].map((day, index) => <option key={day} value={index + 1}>{day}</option>)}</select></label>
                <label>Début<input type="time" value={slotStart} onChange={(event) => setSlotStart(event.target.value)} required /></label>
                <label>Fin<input type="time" value={slotEnd} onChange={(event) => setSlotEnd(event.target.value)} required /></label>
                <button disabled={busy}>Ajouter le créneau</button>
              </form>
              <form className="assessment-form" onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await api("/timetable/sessions", { method: "POST", body: JSON.stringify({ classId, ...sessionForm, dateEnd: sessionForm.dateEnd || null }) });
                  await loadSessions();
                }, "Séance ajoutée sans conflit.");
              }}>
                <label>Matière<select value={sessionForm.subjectId} onChange={(event) => setSessionForm({ ...sessionForm, subjectId: event.target.value })}>{subjects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                <label>Enseignant<select value={sessionForm.teacherId} onChange={(event) => setSessionForm({ ...sessionForm, teacherId: event.target.value })}>{teachers.map((item) => <option key={item.id} value={item.id}>{item.person.nom} {item.person.prenoms}</option>)}</select></label>
                <label>Salle<select value={sessionForm.roomId} onChange={(event) => setSessionForm({ ...sessionForm, roomId: event.target.value })}>{rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label>Créneau<select value={sessionForm.slotId} onChange={(event) => setSessionForm({ ...sessionForm, slotId: event.target.value })}>{slots.map((item) => <option key={item.id} value={item.id}>{item.label} · {formatMinute(item.startMinute)}</option>)}</select></label>
                <label>Valide du<input type="date" value={sessionForm.dateStart} onChange={(event) => setSessionForm({ ...sessionForm, dateStart: event.target.value })} required /></label>
                <label>Au (facultatif)<input type="date" value={sessionForm.dateEnd} onChange={(event) => setSessionForm({ ...sessionForm, dateEnd: event.target.value })} /></label>
                <button disabled={busy || !classId || !slots.length || !rooms.length}>Programmer</button>
              </form>
            </>
          )}
          <div className="table">
            <div className="table-head"><span>Jour / heure</span><span>Matière</span><span>Enseignant</span><span>Salle</span></div>
            {sessions.map((item) => <div className="table-row" key={item.id}><strong>{["", "Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam."][item.slot.weekday]} · {formatMinute(item.slot.startMinute)}–{formatMinute(item.slot.endMinute)}</strong><span>{item.subject.label} · {item.class.name}</span><span>{item.teacher.person.nom} {item.teacher.person.prenoms}</span><span>{item.room.name}</span></div>)}
            {!sessions.length && <p className="empty">Aucune séance programmée pour cette classe.</p>}
          </div>
        </>
      )}

      {page === "appel" && (
        <>
          {attendanceSummary && <div className="checklist">
            <strong>Synthèse du jour · {attendanceSummary.totals.classes} classe(s) avec appel</strong>
            <p>{attendanceSummary.totals.present} présent(s) · {attendanceSummary.totals.absent} absent(s) · {attendanceSummary.totals.late} retard(s) · {attendanceSummary.totals.excused} excusé(s)</p>
            <div className="attendance-summary">{attendanceSummary.classes.map((row: any) => <span key={row.classId}>{row.className} : {row.absent} absent(s), {row.late} retard(s)</span>)}</div>
          </div>}
          <div className="table">
            <div className="table-head"><span>Matricule</span><span>Élève</span><span>Présence</span><span>Détails</span></div>
            {attendance.map((item) => <div className="table-row" key={item.studentId}>
              <span>{item.student.matricule}</span><strong>{item.student.person.nom} {item.student.person.prenoms}</strong>
              <select aria-label={`Présence de ${item.student.person.nom}`} value={item.status} onChange={(event) => setAttendance(attendance.map((row) => row.studentId === item.studentId ? { ...row, status: event.target.value as AttendanceRow["status"] } : row))}>
                <option value="PRESENT">Présent</option><option value="ABSENT">Absent</option><option value="RETARD">En retard</option><option value="EXCUSE">Excusé</option>
              </select>
              <div className="attendance-detail">
                {item.status === "RETARD" && <input aria-label="Minutes de retard" type="number" min="1" value={item.minutesLate ?? ""} placeholder="Minutes" onChange={(event) => setAttendance(attendance.map((row) => row.studentId === item.studentId ? { ...row, minutesLate: Number(event.target.value) || null } : row))} />}
                {(item.status === "ABSENT" || item.status === "RETARD" || item.status === "EXCUSE") && <input aria-label="Justification" value={item.justification ?? ""} placeholder="Motif / justification" onChange={(event) => setAttendance(attendance.map((row) => row.studentId === item.studentId ? { ...row, justification: event.target.value } : row))} />}
              </div>
            </div>)}
            {!attendance.length && <p className="empty">Chargez l'appel pour afficher les élèves inscrits.</p>}
          </div>
          <div className="actions">
            <button className="secondary" disabled={busy || !classId} onClick={() => void act(async () => {
              await loadAttendance();
              await loadAttendanceSummary();
            }, "Appel chargé.")}>Charger l'appel</button>
            <button disabled={busy || !classId} onClick={() => void act(async () => {
              await api("/attendance", { method: "PUT", body: JSON.stringify({ classId, date: attendanceDate, entries: attendance.map(({ studentId, status, minutesLate, justification }) => ({ studentId, status, ...(status === "RETARD" && minutesLate ? { minutesLate } : {}), ...(justification ? { justification } : {}) })) }) });
              await loadAttendance();
            }, "Appel enregistré. Les élèves non signalés restent présents.")}>Enregistrer l'appel</button>
          </div>
          <p className="help">Tous les élèves sont présumés présents ; seuls les absents, retards et dispenses nécessitent une action.</p>
        </>
      )}

      {page === "orientation" && (
        <>
          {allowManagement && <div className="actions">
            <button disabled={busy || !classId} onClick={() => void act(async () => {
              const row = await api<any>("/orientation/campaigns", { method: "POST", body: JSON.stringify({ classId }) });
              await loadCampaigns();
              setCampaignId(row.id);
            }, "Campagne d'orientation créée.")}>Créer la campagne</button>
            {selectedCampaign && <button className="secondary" disabled={busy} onClick={() => void act(async () => {
              const status = selectedCampaign.status === "OUVERTE" ? "CLOTUREE" : "OUVERTE";
              await api(`/orientation/campaigns/${selectedCampaign.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
              await loadCampaigns();
            }, "Statut de la campagne modifié.")}>{selectedCampaign.status === "OUVERTE" ? "Clôturer les vœux" : "Ouvrir les vœux"}</button>}
          </div>}
          <div className="assessment-list">{campaigns.map((campaign) => <button key={campaign.id} className={campaignId === campaign.id ? "selected" : ""} onClick={() => setCampaignId(campaign.id)}>{campaign.status} · {new Date(campaign.createdAt).toLocaleDateString("fr-FR")}</button>)}</div>
          {selectedCampaign && <div className="table">
            <div className="table-head"><span>Élève</span><span>Choix famille</span><span>Avis du conseil</span><span>Décision définitive</span></div>
            {selectedCampaign.students.map((item: any) => <div className="table-row" key={item.id}>
              <strong>{item.student.person.nom} {item.student.person.prenoms}
                <small>{item.provisionalOrientation ? `Prévision : ${item.provisionalOrientation} · ` : ""}Math. {item.meanMaths ?? "—"} · Phys.-chimie {item.meanPhysics ?? "—"} · SVT {item.meanBiology ?? "—"}</small>
              </strong>
              <div className="choice-controls">
                {roles.includes("PAR") && <FamilyChoice item={item} campaign={selectedCampaign} choices={allowedOrientationChoices} busy={busy} act={act} reload={loadCampaigns} />}
                {!roles.includes("PAR") && <span>{item.familyFirst ? `${choiceLabels[item.familyFirst as Choice]}${item.familySecond ? ` / ${choiceLabels[item.familySecond as Choice]}` : ""}` : "Non renseigné"}</span>}
              </div>
              <div className="choice-controls">
                {roles.some((role) => ["DIR", "CEN", "TIT"].includes(role)) ? <select aria-label="Avis du conseil" value={item.councilOpinion ?? ""} onChange={(event) => void act(async () => {
                  await api(`/orientation/campaigns/${selectedCampaign.id}/students/${item.studentId}`, { method: "PUT", body: JSON.stringify({ councilOpinion: event.target.value }) });
                  await loadCampaigns();
                }, "Avis enregistré.")}><option value="">À définir</option>{allowedOrientationChoices.map((value) => <option key={value} value={value}>{choiceLabels[value]}</option>)}</select> : <span>{item.councilOpinion ?? "—"}</span>}
              </div>
              {roles.includes("DIR") && selectedCampaign.status === "CLOTUREE"
                ? <select aria-label="Décision définitive" value={item.finalDecision ?? allowedOrientationChoices[0]} onChange={(event) => void act(async () => {
                  await api(`/orientation/campaigns/${selectedCampaign.id}/students/${item.studentId}`, { method: "PUT", body: JSON.stringify({ finalDecision: event.target.value }) });
                  await loadCampaigns();
                }, "Décision définitive enregistrée.")}>{allowedOrientationChoices.map((value) => <option key={value} value={value}>{choiceLabels[value]}</option>)}</select>
                : <span>{item.finalDecision ? choiceLabels[item.finalDecision as Choice] : "En attente"}</span>}
            </div>)}
            {!selectedCampaign.students.length && <p className="empty">Aucun élève inscrit dans cette campagne.</p>}
          </div>}
        </>
      )}

      {page === "conseil" && (
        <>
          <div className="actions">
            <button disabled={busy || !classId} onClick={() => void act(async () => {
              const row = await api<any>("/council-meetings", { method: "POST", body: JSON.stringify({ classId }) });
              await loadMeetings();
              setMeetingId(row.id);
            }, "Fiche préparatoire créée.")}>Préparer un conseil</button>
            {selectedMeeting && <select aria-label="Conseil sélectionné" value={meetingId} onChange={(event) => setMeetingId(event.target.value)}>{meetings.map((row) => <option key={row.id} value={row.id}>{row.status} · {new Date(row.createdAt).toLocaleDateString("fr-FR")}</option>)}</select>}
          </div>
          {selectedMeeting && <CouncilEditor meeting={selectedMeeting} busy={busy} act={act} reload={loadMeetings} />}
          {!meetings.length && <p className="empty">Aucun conseil de classe préparé.</p>}
        </>
      )}

      {page === "discipline" && <DisciplinePanel classId={classId} roles={roles} busy={busy} act={act} />}

      {page === "cahier" && (
        <>
          {allowTextbook && <form className="assessment-form" onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              await api("/textbook", { method: "POST", body: JSON.stringify({ classId, ...lessonForm }) });
              setLessonForm({ ...lessonForm, chapter: "", content: "", homework: "" });
              await loadTextbook();
            }, "Séance ajoutée au cahier de textes.");
          }}>
            <label>Matière<select value={lessonForm.subjectId || subjects[0]?.id || ""} onChange={(event) => setLessonForm({ ...lessonForm, subjectId: event.target.value })}>{subjects.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>Date<input type="date" value={lessonForm.date} onChange={(event) => setLessonForm({ ...lessonForm, date: event.target.value })} required /></label>
            <label>Chapitre<input value={lessonForm.chapter} onChange={(event) => setLessonForm({ ...lessonForm, chapter: event.target.value })} /></label>
            <label>Contenu / motif<input value={lessonForm.content} onChange={(event) => setLessonForm({ ...lessonForm, content: event.target.value })} required /></label>
            <label>Devoirs<input value={lessonForm.homework} onChange={(event) => setLessonForm({ ...lessonForm, homework: event.target.value })} /></label>
            <label>Cours assuré<select value={String(lessonForm.courseHeld)} onChange={(event) => setLessonForm({ ...lessonForm, courseHeld: event.target.value === "true" })}><option value="true">Oui</option><option value="false">Non</option></select></label>
            <button disabled={busy || !classId || !subjects.length}>Enregistrer</button>
          </form>}
          <div className="report-list">{textbook.map((item) => <article key={item.id}>
            <strong>{new Date(item.date).toLocaleDateString("fr-FR")} · {item.subject.label}</strong>
            <span>{item.courseHeld ? item.chapter ?? item.content : `Cours non assuré : ${item.content}`}</span>
            {item.homework && <span>Devoir : {item.homework}</span>}
            <small>{item.teacher.person.nom} {item.teacher.person.prenoms}</small>
          </article>)}</div>
          {!textbook.length && <p className="empty">Aucune entrée dans le cahier de textes.</p>}
        </>
      )}
    </section>
  );
}

function DisciplinePanel({ classId, roles, busy, act }: {
  classId: string;
  roles: string[];
  busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
}) {
  const [students, setStudents] = useState<Student[]>([]);
  const [incidents, setIncidents] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [scales, setScales] = useState<any[]>([]);
  const [form, setForm] = useState({ studentId: "", category: "", description: "", occurredAt: today(), evidenceRef: "", disciplineCouncilRequired: false });
  const [scaleForm, setScaleForm] = useState({ code: "", label: "", points: "0" });
  const [followUpForm, setFollowUpForm] = useState({ studentId: "", kind: "ENTRETIEN", occurredAt: today(), summary: "", parentContact: "" });
  const [scaleChoices, setScaleChoices] = useState<Record<string, string>>({});
  const [decisionTexts, setDecisionTexts] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");

  const load = async () => {
    if (!classId) return;
    const [studentRows, incidentRows, followUpRows, scaleRows] = await Promise.all([
      api<Student[]>("/students"),
      api<any[]>(`/discipline/incidents?classId=${encodeURIComponent(classId)}`),
      api<any[]>(`/discipline/follow-ups?classId=${encodeURIComponent(classId)}`),
      api<any[]>("/discipline/scales"),
    ]);
    setStudents(studentRows.filter((student) => student.enrollments.some((enrollment) => enrollment.classId === classId)));
    setIncidents(incidentRows);
    setFollowUps(followUpRows);
    setScales(scaleRows);
  };

  useEffect(() => {
    setLoadError("");
    void load().catch((reason) => setLoadError(reason instanceof Error ? reason.message : "Chargement de la discipline impossible"));
  }, [classId]);

  const canDecide = roles.some((role) => ["DIR", "SG"].includes(role));
  const canConfigureScale = roles.some((role) => ["DIR", "CEN", "SG"].includes(role));
  const studentOptions = students.map((student) => <option key={student.id} value={student.id}>{student.person.nom} {student.person.prenoms} · {student.matricule}</option>);

  return <div className="discipline-panel">
    {loadError && <div className="alert" role="alert">{loadError}</div>}
    <h3>Barème des sanctions</h3>
    {canConfigureScale && <form className="assessment-form" onSubmit={(event) => {
      event.preventDefault();
      void act(async () => {
        await api("/discipline/scales", { method: "POST", body: JSON.stringify({ ...scaleForm, points: Number(scaleForm.points) }) });
        setScaleForm({ code: "", label: "", points: "0" });
        await load();
      }, "Sanction ajoutée au barème.");
    }}>
      <label>Code<input value={scaleForm.code} onChange={(event) => setScaleForm({ ...scaleForm, code: event.target.value.toUpperCase() })} placeholder="AVERTISSEMENT" required /></label>
      <label>Sanction<input value={scaleForm.label} onChange={(event) => setScaleForm({ ...scaleForm, label: event.target.value })} required /></label>
      <label>Points<input type="number" min="0" max="1000" step="1" value={scaleForm.points} onChange={(event) => setScaleForm({ ...scaleForm, points: event.target.value })} required /></label>
      <button disabled={busy}>Ajouter au barème</button>
    </form>}
    <div className="assessment-list">{scales.map((scale) => <span className="discipline-scale" key={scale.id}>{scale.label} · {scale.points} pt(s)</span>)}</div>

    <h3>Signaler un incident</h3>
    <form className="assessment-form" onSubmit={(event) => {
      event.preventDefault();
      void act(async () => {
        await api("/discipline/incidents", { method: "POST", body: JSON.stringify({ classId, ...form, evidenceRef: form.evidenceRef || undefined }) });
        setForm({ ...form, category: "", description: "", evidenceRef: "", disciplineCouncilRequired: false });
        await load();
      }, "Incident transmis au surveillant général ou à la direction.");
    }}>
      <label>Élève<select value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })} required><option value="">Choisir…</option>{studentOptions}</select></label>
      <label>Catégorie<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} required /></label>
      <label>Date<input type="date" value={form.occurredAt} onChange={(event) => setForm({ ...form, occurredAt: event.target.value })} required /></label>
      <label>Description<input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} minLength={5} required /></label>
      <label>Référence de pièce (facultatif)<input value={form.evidenceRef} onChange={(event) => setForm({ ...form, evidenceRef: event.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={form.disciplineCouncilRequired} onChange={(event) => setForm({ ...form, disciplineCouncilRequired: event.target.checked })} />Conseil de discipline nécessaire</label>
      <button disabled={busy || !classId || !students.length}>Signaler</button>
    </form>

    <h3>Incidents et décisions</h3>
    <div className="report-list">{incidents.map((incident) => <article key={incident.id}>
      <div>
        <strong>{incident.student.person.nom} {incident.student.person.prenoms} · {incident.category}</strong>
        <span>{new Date(incident.occurredAt).toLocaleDateString("fr-FR")} · {incident.description}</span>
        <span>État : {incident.status} · {incident.scale?.label ?? incident.decision ?? "En attente de décision"}</span>
        {incident.disciplineCouncilRequired && <span>Conseil de discipline requis{incident.disciplineCouncilAt ? ` · ${new Date(incident.disciplineCouncilAt).toLocaleDateString("fr-FR")}` : ""}</span>}
        {incident.parentNotifiedAt && <span>Parents informés le {new Date(incident.parentNotifiedAt).toLocaleDateString("fr-FR")}</span>}
      </div>
      {canDecide && incident.status === "SIGNALE" && <div className="discipline-actions">
        <select aria-label="Sanction retenue" value={scaleChoices[incident.id] ?? ""} onChange={(event) => setScaleChoices({ ...scaleChoices, [incident.id]: event.target.value })}>
          <option value="">Aucune sanction du barème</option>{scales.map((scale) => <option key={scale.id} value={scale.id}>{scale.label} ({scale.points} pt(s))</option>)}
        </select>
        <input aria-label="Décision disciplinaire" placeholder="Décision / motif" value={decisionTexts[incident.id] ?? ""} onChange={(event) => setDecisionTexts({ ...decisionTexts, [incident.id]: event.target.value })} />
        <button disabled={busy || (decisionTexts[incident.id] ?? "").trim().length < 2} onClick={() => void act(async () => {
          await api(`/discipline/incidents/${incident.id}/decision`, { method: "PUT", body: JSON.stringify({
            scaleId: scaleChoices[incident.id] || null,
            decision: decisionTexts[incident.id],
            disciplineCouncilRequired: incident.disciplineCouncilRequired,
          }) });
          await load();
        }, "Décision enregistrée.")}>Décider</button>
      </div>}
      {canDecide && incident.status === "DECIDE" && <button disabled={busy} onClick={() => void act(async () => {
        await api(`/discipline/incidents/${incident.id}/notify-parent`, { method: "POST", body: "{}" });
        await load();
      }, "Notification aux parents consignée. Aucun SMS n'est envoyé automatiquement.")}>Enregistrer l'information des parents</button>}
      {canDecide && incident.status === "NOTIFIE" && <button className="secondary" disabled={busy} onClick={() => void act(async () => {
        await api(`/discipline/incidents/${incident.id}/close`, { method: "POST", body: "{}" });
        await load();
      }, "Incident clôturé.")}>Clôturer</button>}
    </article>)}</div>
    {!incidents.length && <p className="empty">Aucun incident signalé pour cette classe.</p>}

    <h3>Fiche de suivi</h3>
    <form className="assessment-form" onSubmit={(event) => {
      event.preventDefault();
      void act(async () => {
        await api("/discipline/follow-ups", { method: "POST", body: JSON.stringify({ classId, ...followUpForm, parentContact: followUpForm.parentContact || undefined }) });
        setFollowUpForm({ ...followUpForm, summary: "", parentContact: "" });
        await load();
      }, "Suivi de l'élève ajouté.");
    }}>
      <label>Élève<select value={followUpForm.studentId} onChange={(event) => setFollowUpForm({ ...followUpForm, studentId: event.target.value })} required><option value="">Choisir…</option>{studentOptions}</select></label>
      <label>Type<select value={followUpForm.kind} onChange={(event) => setFollowUpForm({ ...followUpForm, kind: event.target.value })}><option value="ENTRETIEN">Entretien</option><option value="APPEL_PARENT">Appel aux parents</option><option value="CONVOCATION">Convocation</option><option value="CONSEIL_DISCIPLINE">Conseil de discipline</option></select></label>
      <label>Date<input type="date" value={followUpForm.occurredAt} onChange={(event) => setFollowUpForm({ ...followUpForm, occurredAt: event.target.value })} required /></label>
      <label>Compte rendu<input value={followUpForm.summary} onChange={(event) => setFollowUpForm({ ...followUpForm, summary: event.target.value })} minLength={5} required /></label>
      <label>Contact parent<input value={followUpForm.parentContact} onChange={(event) => setFollowUpForm({ ...followUpForm, parentContact: event.target.value })} /></label>
      <button disabled={busy || !students.length}>Ajouter au suivi</button>
    </form>
    <div className="report-list">{followUps.map((followUp) => <article key={followUp.id}>
      <strong>{followUp.student.person.nom} {followUp.student.person.prenoms} · {followUp.kind.replaceAll("_", " ").toLowerCase()}</strong>
      <span>{new Date(followUp.occurredAt).toLocaleDateString("fr-FR")} · {followUp.summary}</span>
      {followUp.parentContact && <span>Contact parent : {followUp.parentContact}</span>}
    </article>)}</div>
  </div>;
}

function FamilyChoice({ item, campaign, choices, busy, act, reload }: {
  item: any; campaign: any; choices: Choice[]; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [first, setFirst] = useState<Choice | "">(item.familyFirst ?? "");
  const [second, setSecond] = useState<Choice | "">(item.familySecond ?? "");
  return <div className="choice-controls">
    <select aria-label="Premier vœu" value={first} onChange={(event) => setFirst(event.target.value as Choice | "")}>
      <option value="">Premier choix</option>{choices.map((value) => <option key={value} value={value}>{choiceLabels[value]}</option>)}
    </select>
    <select aria-label="Second vœu" value={second} onChange={(event) => setSecond(event.target.value as Choice | "")}>
      <option value="">Second choix</option>{choices.filter((value) => value !== first).map((value) => <option key={value} value={value}>{choiceLabels[value]}</option>)}
    </select>
    <button disabled={busy || campaign.status !== "OUVERTE" || !first} onClick={() => void act(async () => {
      await api(`/orientation/campaigns/${campaign.id}/students/${item.studentId}`, { method: "PUT", body: JSON.stringify({ familyFirst: first, familySecond: second || null }) });
      await reload();
    }, "Vœux enregistrés.")}>Enregistrer</button>
  </div>;
}

function CouncilEditor({ meeting, busy, act, reload }: {
  meeting: any; busy: boolean;
  act: (operation: () => Promise<void>, success: string) => Promise<void>;
  reload: () => Promise<void>;
}) {
  const [minutes, setMinutes] = useState(meeting.minutes ?? "");
  return <div className="council-editor">
    <label>Procès-verbal<textarea disabled={meeting.status === "ARCHIVE"} value={minutes} onChange={(event) => setMinutes(event.target.value)} rows={5} /></label>
    <div className="actions">
      <button disabled={busy || meeting.status === "ARCHIVE"} onClick={() => void act(async () => {
        await api(`/council-meetings/${meeting.id}`, { method: "PUT", body: JSON.stringify({ minutes, status: "TENU", heldAt: new Date().toISOString() }) });
        await reload();
      }, "Procès-verbal archivé au conseil.")}>Enregistrer le procès-verbal</button>
      <button className="secondary" disabled={busy || meeting.status === "ARCHIVE"} onClick={() => void act(async () => {
        await api(`/council-meetings/${meeting.id}`, { method: "PUT", body: JSON.stringify({ status: "ARCHIVE" }) });
        await reload();
      }, "Conseil archivé.")}>Clôturer</button>
    </div>
    <div className="table">
      <div className="table-head"><span>Élève</span><span>Décision</span><span>Proposition</span><span>Commentaire</span></div>
      {meeting.decisions.map((row: any) => {
        const card = row.student.reportCards?.find((item: any) => item.periodId === meeting.periodId) ?? row.student.reportCards?.[0];
        const snapshot = card?.snapshot;
        return <div className="table-row" key={row.id}>
        <strong>{row.student.person.nom} {row.student.person.prenoms}<small>Moyenne {snapshot?.average ?? "—"} / 20 · Rang {snapshot?.rank ?? "—"}</small></strong>
        <select disabled={busy || meeting.status === "ARCHIVE"} aria-label={`Décision ${row.student.person.nom}`} value={row.decision} onChange={(event) => void act(async () => {
          await api(`/council-meetings/${meeting.id}`, { method: "PUT", body: JSON.stringify({ decisions: [{ studentId: row.studentId, decision: event.target.value }] }) });
          await reload();
        }, "Décision enregistrée.")}><option value="A_DEFINIR">À définir</option><option value="PASSAGE">Passage</option><option value="REDOUBLEMENT">Redoublement</option><option value="ORIENTATION">Orientation</option></select>
        <span>{row.proposal ?? "—"}</span><span>{row.comment ?? "—"}</span>
      </div>;
      })}
    </div>
  </div>;
}
