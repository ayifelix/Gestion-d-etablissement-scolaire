import React, { useEffect, useState } from "react";
import { API_ORIGIN, api } from "./api";

type Year = { id: string; label: string; status: string };
type Level = { id: string; label: string; cycle: { label: string } };
type FeeType = { id: string; code: string; label: string };
type FeeSchedule = { id: string; feeType: FeeType; level: Level; year: Year; amount: number; dueDate: string | null };
type FinanceStudent = { id: string; matricule: string; person: { nom: string; prenoms: string }; enrollments: Array<{ class: { name: string } }> };
type StudentBalance = {
  student: FinanceStudent;
  charges: any[];
  payments: any[];
  totalBalance: number;
};
type ReceiptIdentity = {
  schoolName: string;
  cycleSubtitle: string;
  ministry: string;
  regionalDirectorate: string;
  inspection: string;
  republicMotto: string;
  schoolMotto: string;
  address: string;
  phone: string;
  logoUrl: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);
const money = (value: number) => `${new Intl.NumberFormat("fr-FR").format(value)} F CFA`;

export function FinanceWorkspace({ roles }: { roles: string[] }) {
  const [page, setPage] = useState(roles.includes("ECO") ? "encaissement" : "configuration");
  const [years, setYears] = useState<Year[]>([]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [feeTypes, setFeeTypes] = useState<FeeType[]>([]);
  const [schedules, setSchedules] = useState<FeeSchedule[]>([]);
  const [students, setStudents] = useState<FinanceStudent[]>([]);
  const [studentId, setStudentId] = useState("");
  const [studentBalance, setStudentBalance] = useState<StudentBalance | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [feeTypeForm, setFeeTypeForm] = useState({ code: "", label: "" });
  const [scheduleForm, setScheduleForm] = useState({ feeTypeId: "", yearId: "", levelId: "", amount: "", dueDate: "" });
  const [assignmentForm, setAssignmentForm] = useState({ feeScheduleId: "", studentId: "" });
  const [paymentForm, setPaymentForm] = useState({ chargeId: "", amount: "", method: "ESPECES", transactionRef: "" });
  const [discountForm, setDiscountForm] = useState({ chargeId: "", amount: "", reason: "" });
  const [reversalForm, setReversalForm] = useState({ paymentId: "", reason: "", refundMethod: "ESPECES" });
  const [closureForm, setClosureForm] = useState({ date: today(), countedCash: "" });
  const [latestReceipt, setLatestReceipt] = useState<any>(null);
  const [receiptIdentity, setReceiptIdentity] = useState<ReceiptIdentity | null>(null);
  const [printReceipt, setPrintReceipt] = useState<any>(null);
  const [installmentChargeId, setInstallmentChargeId] = useState("");
  const [installments, setInstallments] = useState([{ dueDate: today(), amount: "" }, { dueDate: today(), amount: "" }]);
  const [closureResult, setClosureResult] = useState<any>(null);

  const isDirector = roles.includes("DIR");
  const isEconomist = roles.includes("ECO");

  const act = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Opération financière impossible");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setError("");
    try {
      const [yearRows, levelRows, typeRows, scheduleRows] = await Promise.all([
        api<Year[]>("/years"),
        api<Level[]>("/finance/levels"),
        api<FeeType[]>("/finance/fee-types"),
        api<FeeSchedule[]>("/finance/schedules"),
      ]);
      setYears(yearRows);
      setLevels(levelRows);
      setFeeTypes(typeRows);
      setSchedules(scheduleRows);
      setScheduleForm((current) => ({
        ...current,
        feeTypeId: current.feeTypeId || typeRows[0]?.id || "",
        yearId: current.yearId || yearRows.find((year) => year.status === "ACTIVE")?.id || yearRows[0]?.id || "",
        levelId: current.levelId || levelRows[0]?.id || "",
      }));
      setAssignmentForm((current) => ({ ...current, feeScheduleId: current.feeScheduleId || scheduleRows[0]?.id || "" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Chargement financier impossible");
    }
  };

  const loadStudents = async () => {
    const rows = await api<FinanceStudent[]>(`/finance/students?search=${encodeURIComponent(search)}`);
    setStudents(rows);
  };

  const loadBalance = async (id: string) => {
    if (!id) {
      setStudentBalance(null);
      return;
    }
    const result = await api<StudentBalance>(`/finance/students/${id}/balance`);
    setStudentBalance(result);
    const nextCharge = result.charges.find((charge) => charge.totals.balance > 0);
    setPaymentForm((current) => ({ ...current, chargeId: nextCharge?.id ?? "" }));
    setDiscountForm((current) => ({ ...current, chargeId: nextCharge?.id ?? "" }));
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    void api<{ identity: ReceiptIdentity }>("/public/site")
      .then((site) => setReceiptIdentity(site.identity))
      .catch(() => { setReceiptIdentity(null); });
  }, []);
  useEffect(() => { void loadStudents().catch((reason) => setError(reason instanceof Error ? reason.message : "Élèves introuvables")); }, [search]);
  useEffect(() => {
    if (studentId) void loadBalance(studentId).catch((reason) => setError(reason instanceof Error ? reason.message : "Solde indisponible"));
  }, [studentId]);

  const chargeOptions = (studentBalance?.charges ?? []).filter((charge) => charge.totals.balance > 0);

  return <section>
    <p className="eyebrow">J4 · M11 · journal financier en XOF</p>
    <div className="finance-tabs">
      {[
        ["configuration", "Tarifs et affectations", isDirector || isEconomist],
        ["encaissement", "Encaissement et soldes", true],
        ["caisse", "Clôture de caisse", true],
      ].filter(([, , visible]) => visible)
        .map(([id, label]) => <button key={id as string} className={page === id ? "active" : ""} onClick={() => setPage(id as string)}>{label}</button>)}
    </div>
    {error && <div className="alert" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}

    {page === "configuration" && (
      <>
        <h2>Types de frais et tarifs</h2>
        <form className="assessment-form" onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            await api("/finance/fee-types", { method: "POST", body: JSON.stringify({ code: feeTypeForm.code.toUpperCase(), label: feeTypeForm.label }) });
            setFeeTypeForm({ code: "", label: "" });
            await refresh();
          }, "Type de frais créé.");
        }}>
          <label>Code<input value={feeTypeForm.code} onChange={(event) => setFeeTypeForm({ ...feeTypeForm, code: event.target.value })} placeholder="APE" required /></label>
          <label>Libellé<input value={feeTypeForm.label} onChange={(event) => setFeeTypeForm({ ...feeTypeForm, label: event.target.value })} placeholder="Contribution APE" required /></label>
          <button disabled={busy}>Créer le type</button>
        </form>
        <form className="assessment-form" onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            await api("/finance/schedules", { method: "POST", body: JSON.stringify({
              ...scheduleForm,
              amount: Number(scheduleForm.amount),
              dueDate: scheduleForm.dueDate || null,
            }) });
            setScheduleForm({ ...scheduleForm, amount: "", dueDate: "" });
            await refresh();
          }, "Tarif annuel enregistré.");
        }}>
          <label>Type<select value={scheduleForm.feeTypeId} onChange={(event) => setScheduleForm({ ...scheduleForm, feeTypeId: event.target.value })}>{feeTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Année<select value={scheduleForm.yearId} onChange={(event) => setScheduleForm({ ...scheduleForm, yearId: event.target.value })}>{years.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Niveau<select value={scheduleForm.levelId} onChange={(event) => setScheduleForm({ ...scheduleForm, levelId: event.target.value })}>{levels.map((item) => <option key={item.id} value={item.id}>{item.cycle.label} · {item.label}</option>)}</select></label>
          <label>Montant (FCFA)<input type="number" min="1" step="1" value={scheduleForm.amount} onChange={(event) => setScheduleForm({ ...scheduleForm, amount: event.target.value })} required /></label>
          <label>Échéance<input type="date" value={scheduleForm.dueDate} onChange={(event) => setScheduleForm({ ...scheduleForm, dueDate: event.target.value })} /></label>
          <button disabled={busy || !feeTypes.length || !levels.length || !years.length}>Créer le tarif</button>
        </form>
        <div className="table">
          <div className="table-head"><span>Année / niveau</span><span>Type</span><span>Montant</span><span>Affecter à un élève</span></div>
          {schedules.map((schedule) => <div className="table-row" key={schedule.id}>
            <strong>{schedule.year.label} · {schedule.level.label}</strong><span>{schedule.feeType.label}</span><span>{money(schedule.amount)}</span>
            <div className="finance-action">
              <select aria-label="Élève à facturer" value={assignmentForm.studentId} onChange={(event) => setAssignmentForm({ ...assignmentForm, studentId: event.target.value })}>
                <option value="">Choisir…</option>{students.map((student) => <option key={student.id} value={student.id}>{student.person.nom} {student.person.prenoms}</option>)}
              </select>
              <button disabled={busy || !assignmentForm.studentId} onClick={() => void act(async () => {
                await api("/finance/charges/assign", { method: "POST", body: JSON.stringify({ feeScheduleId: schedule.id, studentIds: [assignmentForm.studentId] }) });
                setStudentId(assignmentForm.studentId);
              }, "Frais affecté à l'élève.")}>Affecter</button>
            </div>
          </div>)}
          {!schedules.length && <p className="empty">Aucun tarif configuré. Les montants ne sont pas préremplis : faites valider les tarifs par la direction.</p>}
        </div>
      </>
    )}

    {page === "encaissement" && (
      <>
        <div className="finance-search">
          <label>Rechercher un élève<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nom ou matricule" /></label>
          <label>Élève<select value={studentId} onChange={(event) => setStudentId(event.target.value)}><option value="">Choisir…</option>{students.map((student) => <option key={student.id} value={student.id}>{student.person.nom} {student.person.prenoms} · {student.matricule}</option>)}</select></label>
        </div>
        {studentBalance && <>
          <div className="finance-total">
            <strong>{studentBalance.student.person.nom} {studentBalance.student.person.prenoms}</strong>
            <span>Solde dû : {money(studentBalance.totalBalance)}</span>
          </div>
          <div className="table">
            <div className="table-head"><span>Frais / année</span><span>Montant</span><span>Remise / encaissé</span><span>Solde</span></div>
            {studentBalance.charges.map((charge) => <div className="table-row" key={charge.id}>
              <strong>{charge.feeSchedule.feeType.label} · {charge.year.label}</strong>
              <span>{money(charge.amount)}</span>
              <span>{money(charge.totals.discountTotal)} remise · {money(charge.totals.paidTotal)} payé</span>
              <span className={charge.totals.balance > 0 ? "badge pending" : "badge valid"}>{money(charge.totals.balance)}</span>
            </div>)}
            {!studentBalance.charges.length && <p className="empty">Aucun frais affecté à cet élève.</p>}
          </div>
          {!!chargeOptions.length && isEconomist && <form className="assessment-form" onSubmit={(event) => {
            event.preventDefault();
            void act(async () => {
              const payment = await api<any>("/finance/payments", { method: "POST", body: JSON.stringify({
                studentId,
                method: paymentForm.method,
                amount: Number(paymentForm.amount),
                transactionRef: paymentForm.transactionRef || undefined,
                allocations: [{ chargeId: paymentForm.chargeId, amount: Number(paymentForm.amount) }],
              }) });
              setLatestReceipt(payment);
              setPaymentForm({ ...paymentForm, amount: "", transactionRef: "" });
              await loadBalance(studentId);
            }, "Paiement encaissé et reçu numéroté.");
          }}>
            <label>Frais<select value={paymentForm.chargeId} onChange={(event) => setPaymentForm({ ...paymentForm, chargeId: event.target.value })}>{chargeOptions.map((charge) => <option key={charge.id} value={charge.id}>{charge.feeSchedule.feeType.label} · reste {money(charge.totals.balance)}</option>)}</select></label>
            <label>Montant (FCFA)<input type="number" min="1" step="1" value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} required /></label>
            <label>Mode<select value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}><option value="ESPECES">Espèces</option><option value="MOBILE_MONEY">Mobile money</option><option value="BANQUE">Banque</option></select></label>
            <label>Référence (facultatif)<input value={paymentForm.transactionRef} onChange={(event) => setPaymentForm({ ...paymentForm, transactionRef: event.target.value })} /></label>
            <button disabled={busy || !paymentForm.amount}>Encaisser et éditer le reçu</button>
          </form>}
          {latestReceipt && <div className="checklist">
            <strong>Reçu {latestReceipt.receiptNumber}</strong>
            <p>{money(latestReceipt.amount)} · vérification : {latestReceipt.qrToken}</p>
            <button type="button" className="secondary" onClick={() => {
              setPrintReceipt(latestReceipt);
              window.setTimeout(() => window.print(), 100);
            }}>Imprimer le reçu</button>
          </div>}
          {isDirector && !!chargeOptions.length && <DiscountForm
            charges={chargeOptions}
            busy={busy}
            onSubmit={(chargeId, discountAmount, reason) => act(async () => {
              await api(`/finance/charges/${chargeId}/discount`, { method: "POST", body: JSON.stringify({ amount: discountAmount, reason }) });
              await loadBalance(studentId);
            }, "Remise motivée et autorisée par la direction.")}
          />}
          {isDirector && <div className="table">
            <div className="table-head"><span>Reçu</span><span>Date / mode</span><span>Montant</span><span>Annulation</span></div>
            {studentBalance.payments.map((payment) => <div className="table-row" key={payment.id}>
              <strong>{payment.receiptNumber}</strong><span>{new Date(payment.paidAt).toLocaleDateString("fr-FR")} · {payment.method}</span>
              <span>{money(payment.amount)}</span>
              {payment.reversal ? <span>Annulé · {payment.reversal.reason}</span> : <button className="danger-button" disabled={busy} onClick={() => {
                const reason = window.prompt("Motif obligatoire de l'annulation :");
                if (reason) void act(async () => {
                  await api(`/finance/payments/${payment.id}/reversal`, { method: "POST", body: JSON.stringify({ reason, refundMethod: payment.method }) });
                  await loadBalance(studentId);
                }, "Écriture contraire autorisée. Le reçu original est conservé.");
              }}>Annuler…</button>}
            </div>)}
          </div>}
          <InstallmentEditor
            charges={studentBalance.charges}
            installments={installments}
            setInstallments={setInstallments}
            selectedChargeId={installmentChargeId}
            setSelectedChargeId={setInstallmentChargeId}
            busy={busy}
            onSave={(chargeId, plan) => act(async () => {
              await api(`/finance/charges/${chargeId}/installments`, { method: "POST", body: JSON.stringify({ installments: plan.map((item) => ({ dueDate: item.dueDate, amount: Number(item.amount) })) }) });
              await loadBalance(studentId);
            }, "Échéancier négocié enregistré.")}
          />
        </>}
      </>
    )}

    {page === "caisse" && (
      <>
        {isEconomist && <form className="assessment-form" onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const result = await api<any>("/finance/cash-closures", { method: "POST", body: JSON.stringify({ ...closureForm, countedCash: Number(closureForm.countedCash) }) });
            setClosureResult(result);
          }, "Clôture quotidienne enregistrée.");
        }}>
          <label>Date<input type="date" value={closureForm.date} onChange={(event) => setClosureForm({ ...closureForm, date: event.target.value })} required /></label>
          <label>Espèces comptées (FCFA)<input type="number" min="0" step="1" value={closureForm.countedCash} onChange={(event) => setClosureForm({ ...closureForm, countedCash: event.target.value })} required /></label>
          <button disabled={busy}>Clôturer ma caisse</button>
        </form>}
        {closureResult && <div className="checklist">
          <strong>Écart : {money(closureResult.difference)}</strong>
          <p>Attendu {money(closureResult.expectedCash)} · compté {money(closureResult.countedCash)}</p>
        </div>}
        <CashClosureList key={closureResult?.id ?? "initial"} />
      </>
    )}
    {printReceipt && <div className="printable-document">
      <header className="document-identity">
        {receiptIdentity?.logoUrl && /^\/api\/public\/media\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(receiptIdentity.logoUrl) &&
          <img src={`${API_ORIGIN}${receiptIdentity.logoUrl}`} alt="" />}
        <div><strong>{receiptIdentity?.schoolName ?? "Établissement scolaire"}</strong>
          <span>{receiptIdentity?.ministry}</span>
          <span>{receiptIdentity?.regionalDirectorate} · {receiptIdentity?.inspection}</span>
          <span>{receiptIdentity?.cycleSubtitle}</span>
          {receiptIdentity?.address && <span>{receiptIdentity.address}</span>}
        </div>
      </header>
      <h1>Reçu de paiement</h1>
      <p>Numéro : <strong>{printReceipt.receiptNumber}</strong></p>
      <p>Élève : {printReceipt.student?.person?.nom} {printReceipt.student?.person?.prenoms}</p>
      <p>Matricule : {printReceipt.student?.matricule}</p>
      <p>Montant : <strong>{money(printReceipt.amount)}</strong></p>
      <p>Mode : {printReceipt.method} · Date : {new Date(printReceipt.paidAt).toLocaleString("fr-FR")}</p>
      <p>Vérification : {API_ORIGIN}/api/public/verify?code={encodeURIComponent(printReceipt.qrToken)}</p>
      <footer>{receiptIdentity?.schoolMotto} · {receiptIdentity?.republicMotto}</footer>
    </div>}
  </section>;
}

function DiscountForm({ charges, busy, onSubmit }: {
  charges: any[];
  busy: boolean;
  onSubmit: (chargeId: string, amount: number, reason: string) => Promise<void>;
}) {
  const [chargeId, setChargeId] = useState(charges[0]?.id ?? "");
  const [discountAmount, setDiscountAmount] = useState("");
  const [reason, setReason] = useState("");
  return <form className="assessment-form" onSubmit={(event) => {
    event.preventDefault();
    void onSubmit(chargeId, Number(discountAmount), reason);
  }}>
    <label>Frais à remiser<select value={chargeId} onChange={(event) => setChargeId(event.target.value)}>{charges.map((charge) => <option key={charge.id} value={charge.id}>{charge.feeSchedule.feeType.label} · reste {money(charge.totals.balance)}</option>)}</select></label>
    <label>Remise (FCFA)<input type="number" min="1" step="1" value={discountAmount} onChange={(event) => setDiscountAmount(event.target.value)} required /></label>
    <label>Motif obligatoire<input value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} required /></label>
    <button className="secondary" disabled={busy}>Autoriser la remise</button>
  </form>;
}

function InstallmentEditor({ charges, installments, setInstallments, selectedChargeId, setSelectedChargeId, busy, onSave }: {
  charges: any[];
  installments: Array<{ dueDate: string; amount: string }>;
  setInstallments: (items: Array<{ dueDate: string; amount: string }>) => void;
  selectedChargeId: string;
  setSelectedChargeId: (id: string) => void;
  busy: boolean;
  onSave: (chargeId: string, plan: Array<{ dueDate: string; amount: string }>) => Promise<void>;
}) {
  const eligible = charges.filter((charge) => !charge.installments.length && !charge.allocations.length && charge.totals.balance > 0);
  if (!eligible.length) return null;
  return <form className="assessment-form" onSubmit={(event) => {
    event.preventDefault();
    void onSave(selectedChargeId || eligible[0].id, installments);
  }}>
    <label>Frais à échéancer<select value={selectedChargeId || eligible[0].id} onChange={(event) => setSelectedChargeId(event.target.value)}>{eligible.map((charge) => <option key={charge.id} value={charge.id}>{charge.feeSchedule.feeType.label} · {money(charge.totals.balance)}</option>)}</select></label>
    {installments.map((item, index) => <React.Fragment key={index}>
      <label>Échéance {index + 1}<input type="date" value={item.dueDate} onChange={(event) => setInstallments(installments.map((row, i) => i === index ? { ...row, dueDate: event.target.value } : row))} required /></label>
      <label>Montant {index + 1} (FCFA)<input type="number" min="1" step="1" value={item.amount} onChange={(event) => setInstallments(installments.map((row, i) => i === index ? { ...row, amount: event.target.value } : row))} required /></label>
    </React.Fragment>)}
    <button type="button" className="secondary" disabled={busy || installments.length >= 24} onClick={() => setInstallments([...installments, { dueDate: today(), amount: "" }])}>Ajouter une échéance</button>
    <button disabled={busy}>Enregistrer l'échéancier</button>
  </form>;
}

function CashClosureList() {
  const [closures, setClosures] = useState<any[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    void api<any[]>("/finance/cash-closures").then(setClosures).catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Clôtures indisponibles"),
    );
  }, []);
  return <>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="report-list">{closures.map((closure) => <article key={closure.id}>
      <strong>{new Date(closure.date).toLocaleDateString("fr-FR")}</strong>
      <span>Attendu {money(closure.expectedCash)} · compté {money(closure.countedCash)} · écart {money(closure.difference)}</span>
    </article>)}</div>
  </>;
}
