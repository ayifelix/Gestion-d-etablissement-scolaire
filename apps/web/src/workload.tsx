import { useEffect, useState } from "react";
import { api } from "./api";

type AcademicYear = {
  id: string;
  label: string;
  status: string;
  dateStart: string;
  dateEnd: string;
};

type WorkloadRow = {
  teacherId: string;
  teacherName: string;
  teacherStatus: string;
  cycleId: string | null;
  cycleLabel: string | null;
  assignmentWeeklyHours: number;
  plannedHours: number;
  scheduledWeeklyHours: number;
  scheduledHours: number;
  performedHours: number;
  overtimeHours: number;
  unmeasuredEntries: number;
  alerts: string[];
};

type WorkloadReport = {
  year: { id: string; label: string };
  month: string;
  rows: WorkloadRow[];
  cycles: Array<{
    cycleId: string | null;
    cycleLabel: string | null;
    assignmentWeeklyHours: number;
    plannedHours: number;
    scheduledHours: number;
    performedHours: number;
    overtimeHours: number;
  }>;
};

function csvCell(value: string | number) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv(report: WorkloadReport) {
  const headers = [
    "Enseignant",
    "Statut",
    "Cycle",
    "Affectation hebdomadaire",
    "Prévision mensuelle",
    "Emploi du temps mensuel",
    "Heures effectuées",
    "Heures supplémentaires",
    "Cours sans durée mesurable",
    "Alertes",
  ];
  const lines = [
    headers,
    ...report.rows.map((row) => [
      row.teacherName,
      row.teacherStatus,
      row.cycleLabel ?? "Non renseigné",
      row.assignmentWeeklyHours,
      row.plannedHours,
      row.scheduledHours,
      row.performedHours,
      row.overtimeHours,
      row.unmeasuredEntries,
      row.alerts.join(" | ") || "Aucune",
    ]),
  ];
  const content = `\uFEFF${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `charge-horaire-${report.month}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function WorkloadWorkspace({ roles }: { roles: string[] }) {
  const [years, setYears] = useState<AcademicYear[]>([]);
  const [yearId, setYearId] = useState("");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<WorkloadReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    void api<AcademicYear[]>("/years")
      .then((items) => {
        if (!active) return;
        setYears(items);
        const selected = items.find((item) => item.status === "ACTIVE") ?? items[0];
        if (selected) setYearId(selected.id);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Années scolaires indisponibles");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!yearId || !month) return;
    let active = true;
    setLoading(true);
    setError("");
    void api<WorkloadReport>(`/workload?yearId=${encodeURIComponent(yearId)}&month=${encodeURIComponent(month)}`)
      .then((result) => {
        if (active) setReport(result);
      })
      .catch((reason) => {
        if (!active) return;
        setReport(null);
        setError(reason instanceof Error ? reason.message : "Tableau de charge indisponible");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [yearId, month]);

  const totals = report?.rows.reduce((summary, row) => ({
    planned: summary.planned + row.plannedHours,
    performed: summary.performed + row.performedHours,
    overtime: summary.overtime + row.overtimeHours,
    alerts: summary.alerts + row.alerts.length,
  }), { planned: 0, performed: 0, overtime: 0, alerts: 0 }) ?? {
    planned: 0,
    performed: 0,
    overtime: 0,
    alerts: 0,
  };
  const teachersOfInterest = report?.rows.filter((row) =>
    row.teacherStatus === "VOLONTAIRE" || row.teacherStatus === "VACATAIRE",
  ) ?? [];

  return (
    <section className="workload-panel">
      <div className="toolbar">
        <div><p className="eyebrow">M12 · suivi mensuel sans calcul de paie</p><h2>Charge horaire des enseignants</h2></div>
        <div className="filters">
          <label>Année scolaire
            <select value={yearId} onChange={(event) => setYearId(event.target.value)}>
              <option value="">Choisir…</option>
              {years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}
            </select>
          </label>
          <label>Mois<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
          <button className="secondary" onClick={() => report && exportCsv(report)} disabled={!report || loading}>Exporter le mois (CSV)</button>
        </div>
      </div>

      {error && <div className="alert" role="alert">{error}</div>}
      {loading && <p className="help" role="status">Calcul de la charge en cours…</p>}
      {report && (
        <>
          <div className="metrics">
            <article><span>Enseignants affichés</span><strong>{report.rows.length}</strong></article>
            <article><span>Heures prévues</span><strong>{totals.planned.toFixed(2)} h</strong></article>
            <article><span>Heures effectuées</span><strong>{totals.performed.toFixed(2)} h</strong></article>
            <article><span>Heures supplémentaires</span><strong>{totals.overtime.toFixed(2)} h</strong></article>
          </div>

          <div className="checklist">
            <h3>Alertes et qualité de saisie</h3>
            {totals.alerts
              ? report.rows.flatMap((row) => row.alerts.map((message, index) => (
                <p className="checklist-item" key={`${row.teacherId}-${row.cycleId}-${index}`}>
                  {row.teacherName} · {row.cycleLabel ?? "sans cycle"} : {message}
                </p>
              )))
              : <p className="checklist-ok">Aucun dépassement constaté sur les données disponibles.</p>}
            <p className="help">Les heures prévues sont projetées à partir des affectations ; l'emploi du temps est présenté séparément. Les cours effectués ne sont mesurables que lorsqu'ils sont liés à une séance horaire.</p>
          </div>

          <h3>Vacataires et volontaires</h3>
          {teachersOfInterest.length
            ? <p className="help">{teachersOfInterest.length} affectation(s) de vacataire(s) ou volontaire(s) sur la période.</p>
            : <p className="empty">Aucun vacataire ou volontaire affecté sur cette période.</p>}

          <div className="table workload-table">
            <div className="table-head">
              <span>Enseignant</span><span>Cycle / statut</span><span>Affectation / sem.</span><span>Prévu / effectué</span><span>Supplémentaires</span><span>Alertes</span>
            </div>
            {report.rows.map((row) => (
              <div className="table-row" key={`${row.teacherId}-${row.cycleId ?? "sans-cycle"}`}>
                <strong>{row.teacherName || "Enseignant"}</strong>
                <span>{row.cycleLabel ?? "Non renseigné"} · {row.teacherStatus.replaceAll("_", " ").toLowerCase()}</span>
                <span>{row.assignmentWeeklyHours.toFixed(2)} h</span>
                <span>{row.plannedHours.toFixed(2)} h / {row.performedHours.toFixed(2)} h</span>
                <span>{row.overtimeHours.toFixed(2)} h</span>
                <span className={row.alerts.length ? "badge pending" : "badge valid"}>{row.alerts.length || "Aucune"}</span>
              </div>
            ))}
            {!report.rows.length && <p className="empty">Aucune charge enregistrée pour cette période et votre périmètre.</p>}
          </div>

          <h3>Totaux par cycle</h3>
          <div className="table workload-cycle-table">
            <div className="table-head"><span>Cycle</span><span>Affectation hebdomadaire</span><span>Prévu</span><span>Emploi du temps</span><span>Effectué</span><span>Supplémentaires</span></div>
            {report.cycles.map((cycle) => (
              <div className="table-row" key={cycle.cycleId ?? "sans-cycle"}>
                <strong>{cycle.cycleLabel ?? "Non renseigné"}</strong>
                <span>{cycle.assignmentWeeklyHours.toFixed(2)} h</span>
                <span>{cycle.plannedHours.toFixed(2)} h</span>
                <span>{cycle.scheduledHours.toFixed(2)} h</span>
                <span>{cycle.performedHours.toFixed(2)} h</span>
                <span>{cycle.overtimeHours.toFixed(2)} h</span>
              </div>
            ))}
          </div>
        </>
      )}
      {!roles.some((role) => ["DIR", "CEN", "PROF", "TIT"].includes(role)) && (
        <p className="empty">Vous n'avez pas accès au tableau de charge horaire.</p>
      )}
    </section>
  );
}
