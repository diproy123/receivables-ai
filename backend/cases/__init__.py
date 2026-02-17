"""
AuditLens — Case Management & Workflow Orchestration

Architecture:
  Cases are created automatically when anomalies trigger BLOCK or REVIEW triage.
  Each case tracks: assignment, status workflow, SLA, activity log, and escalation.
  Cases can group related anomalies on the same invoice into a single investigation.
  Manual cases can be created for ad-hoc investigations.

Case Lifecycle:
  OPEN → INVESTIGATING → PENDING_VENDOR → PENDING_APPROVAL → RESOLVED → CLOSED
                ↓                                                  ↑
            ESCALATED ──────────────────────────────────────────────┘

SLA:
  Each priority has a target resolution time. Cases approaching SLA breach
  are flagged for escalation. Overdue cases are auto-escalated.

Assignment:
  Cases are assigned to specific users. Unassigned cases appear in the team queue.
  Workload balancing is visible via the case dashboard.
"""

import uuid
from datetime import datetime, timedelta

# ============================================================
# CASE CONSTANTS
# ============================================================
CASE_STATUSES = ["open", "investigating", "pending_vendor", "pending_approval", "escalated", "resolved", "closed"]
CASE_PRIORITIES = ["critical", "high", "medium", "low"]

# SLA targets in hours per priority — read from policy config at runtime
_SLA_DEFAULTS = {"critical": 4, "high": 24, "medium": 72, "low": 168}

def get_sla_targets() -> dict:
    """Get SLA targets from policy config, falling back to defaults."""
    try:
        from backend.policy import get_policy
        policy = get_policy()
        return {
            "critical": int(policy.get("sla_critical_hours", _SLA_DEFAULTS["critical"])),
            "high": int(policy.get("sla_high_hours", _SLA_DEFAULTS["high"])),
            "medium": int(policy.get("sla_medium_hours", _SLA_DEFAULTS["medium"])),
            "low": int(policy.get("sla_low_hours", _SLA_DEFAULTS["low"])),
        }
    except Exception:
        return dict(_SLA_DEFAULTS)

# Module-level alias for backward compat (used in tests)
SLA_TARGETS = _SLA_DEFAULTS

# SLA warning threshold: flag when X% of SLA time has elapsed
SLA_WARNING_PCT = 0.75

# Case types
CASE_TYPES = [
    "anomaly_investigation",     # Auto-created from BLOCK/REVIEW triage
    "duplicate_review",          # Auto-created for duplicate invoices
    "vendor_dispute",            # Manual: dispute with vendor over charges
    "contract_violation",        # Auto-created for contract-related anomalies
    "authority_escalation",      # Auto-created when invoice exceeds authority
    "general_investigation",     # Manual: ad-hoc investigation
]


# ============================================================
# CASE CREATION
# ============================================================
def create_case(
    case_type: str,
    title: str,
    description: str,
    priority: str = "medium",
    invoice_id: str = None,
    anomaly_ids: list = None,
    vendor: str = None,
    amount_at_risk: float = 0,
    currency: str = "USD",
    created_by: str = "system",
    assigned_to: str = None,
) -> dict:
    """Create a new case. Returns the case record."""
    now = datetime.now()
    targets = get_sla_targets()
    sla_hours = targets.get(priority, 72)
    sla_deadline = now + timedelta(hours=sla_hours)

    case = {
        "id": "CASE-" + str(uuid.uuid4())[:8].upper(),
        "type": case_type,
        "title": title,
        "description": description,
        "status": "open",
        "priority": priority,
        "invoiceId": invoice_id,
        "anomalyIds": anomaly_ids or [],
        "vendor": vendor,
        "amountAtRisk": amount_at_risk,
        "currency": currency,
        "createdAt": now.isoformat(),
        "createdBy": created_by,
        "assignedTo": assigned_to,
        "assignedAt": now.isoformat() if assigned_to else None,
        "sla": {
            "targetHours": sla_hours,
            "deadline": sla_deadline.isoformat(),
            "warningAt": (now + timedelta(hours=sla_hours * SLA_WARNING_PCT)).isoformat(),
            "breached": False,
            "breachedAt": None,
        },
        "resolution": None,
        "resolvedAt": None,
        "resolvedBy": None,
        "closedAt": None,
        "closedBy": None,
        "escalatedTo": None,
        "escalatedAt": None,
        "escalationReason": None,
        "notes": [],
        "statusHistory": [
            {"status": "open", "at": now.isoformat(), "by": created_by, "reason": "Case created"}
        ],
    }
    return case


# ============================================================
# AUTO-CASE CREATION FROM TRIAGE
# ============================================================
def auto_create_cases_from_triage(invoice: dict, anomalies: list, triage_result: dict, db: dict, created_by: str = "system") -> list:
    """Auto-create cases when triage routes invoice to BLOCK or REVIEW.
    Groups related anomalies into single cases where appropriate.
    Returns list of new cases created."""

    lane = triage_result.get("lane", "")
    if lane not in ("BLOCK", "REVIEW"):
        return []

    inv_id = invoice.get("id")
    vendor = invoice.get("vendor", "Unknown")
    currency = invoice.get("currency", "USD")
    inv_anomalies = [a for a in anomalies if a.get("invoiceId") == inv_id and a.get("status") == "open"]

    if not inv_anomalies:
        return []

    # Check if case already exists for this invoice
    existing_cases = [c for c in db.get("cases", [])
                      if c.get("invoiceId") == inv_id and c["status"] not in ("resolved", "closed")]
    if existing_cases:
        # Update existing case with any new anomaly IDs and re-evaluate priority
        for ec in existing_cases:
            new_aids = [a["id"] for a in inv_anomalies if a["id"] not in ec["anomalyIds"]]
            if new_aids:
                ec["anomalyIds"].extend(new_aids)
                ec["amountAtRisk"] = sum(
                    abs(float(a.get("amount_at_risk") or 0))
                    for a in inv_anomalies if a["id"] in ec["anomalyIds"]
                )
                # Re-evaluate priority: upgrade if new anomalies are more severe
                has_high = any(a.get("severity") == "high" for a in inv_anomalies if a["id"] in ec["anomalyIds"])
                if lane == "BLOCK" and has_high and ec["priority"] not in ("critical",):
                    old_pri = ec["priority"]
                    ec["priority"] = "critical"
                    targets = get_sla_targets()
                    ec["sla"]["targetHours"] = targets["critical"]
                    ec["sla"]["deadline"] = (datetime.fromisoformat(ec["createdAt"]) + timedelta(hours=targets["critical"])).isoformat()
                    ec["sla"]["warningAt"] = (datetime.fromisoformat(ec["createdAt"]) + timedelta(hours=targets["critical"] * SLA_WARNING_PCT)).isoformat()
                    ec["statusHistory"].append({
                        "status": ec["status"], "at": datetime.now().isoformat(),
                        "by": "system", "reason": f"Priority escalated {old_pri} → critical (new high-severity anomaly added)"
                    })
                elif lane == "BLOCK" and ec["priority"] not in ("critical", "high"):
                    old_pri = ec["priority"]
                    ec["priority"] = "high"
                    ec["statusHistory"].append({
                        "status": ec["status"], "at": datetime.now().isoformat(),
                        "by": "system", "reason": f"Priority escalated {old_pri} → high (BLOCK triage, new anomalies added)"
                    })
        return []

    new_cases = []

    # Group anomalies by category for case creation
    duplicates = [a for a in inv_anomalies if a.get("type") == "DUPLICATE_INVOICE"]
    contract_viols = [a for a in inv_anomalies if a.get("type") in ("TERMS_VIOLATION",)]
    price_qty = [a for a in inv_anomalies if a.get("type") in ("PRICE_OVERCHARGE", "QUANTITY_MISMATCH", "AMOUNT_DISCREPANCY", "UNAUTHORIZED_ITEM", "OVERBILLED_VS_RECEIVED", "QUANTITY_RECEIVED_MISMATCH")]
    other = [a for a in inv_anomalies if a not in duplicates + contract_viols + price_qty]

    inv_num = invoice.get("invoiceNumber") or invoice.get("id", "")[:8]

    def _risk(anoms):
        return round(sum(abs(float(a.get("amount_at_risk") or 0)) for a in anoms), 2)

    def _priority(anoms, lane):
        if lane == "BLOCK":
            has_high = any(a.get("severity") == "high" for a in anoms)
            return "critical" if has_high else "high"
        return "medium"

    # Create grouped cases
    if duplicates:
        new_cases.append(create_case(
            case_type="duplicate_review",
            title=f"Duplicate Invoice Review: {inv_num}",
            description=f"Invoice {inv_num} from {vendor} flagged as potential duplicate. {len(duplicates)} duplicate signal(s) detected. Requires verification before payment can proceed.",
            priority="high",
            invoice_id=inv_id,
            anomaly_ids=[a["id"] for a in duplicates],
            vendor=vendor,
            amount_at_risk=_risk(duplicates),
            currency=currency,
            created_by=created_by,
        ))

    if contract_viols:
        new_cases.append(create_case(
            case_type="contract_violation",
            title=f"Contract Violation: {inv_num}",
            description=f"Invoice {inv_num} from {vendor} violates contract terms. {len(contract_viols)} violation(s): {', '.join(a.get('type','') for a in contract_viols)}. Review contract compliance before approval.",
            priority=_priority(contract_viols, lane),
            invoice_id=inv_id,
            anomaly_ids=[a["id"] for a in contract_viols],
            vendor=vendor,
            amount_at_risk=_risk(contract_viols),
            currency=currency,
            created_by=created_by,
        ))

    if price_qty:
        new_cases.append(create_case(
            case_type="anomaly_investigation",
            title=f"Pricing/Quantity Investigation: {inv_num}",
            description=f"Invoice {inv_num} from {vendor} has {len(price_qty)} pricing or quantity discrepanc{'y' if len(price_qty)==1 else 'ies'} against PO. Total amount at risk: {currency} {_risk(price_qty):,.2f}.",
            priority=_priority(price_qty, lane),
            invoice_id=inv_id,
            anomaly_ids=[a["id"] for a in price_qty],
            vendor=vendor,
            amount_at_risk=_risk(price_qty),
            currency=currency,
            created_by=created_by,
        ))

    if other:
        new_cases.append(create_case(
            case_type="anomaly_investigation",
            title=f"Anomaly Review: {inv_num}",
            description=f"Invoice {inv_num} from {vendor} has {len(other)} anomal{'y' if len(other)==1 else 'ies'} requiring review: {', '.join(a.get('type','') for a in other)}.",
            priority=_priority(other, lane),
            invoice_id=inv_id,
            anomaly_ids=[a["id"] for a in other],
            vendor=vendor,
            amount_at_risk=_risk(other),
            currency=currency,
            created_by=created_by,
        ))

    return new_cases


# ============================================================
# CASE STATUS TRANSITIONS
# ============================================================
ALLOWED_TRANSITIONS = {
    "open":              ["investigating", "escalated", "resolved", "closed"],
    "investigating":     ["pending_vendor", "pending_approval", "escalated", "resolved", "closed"],
    "pending_vendor":    ["investigating", "escalated", "resolved", "closed"],
    "pending_approval":  ["investigating", "escalated", "resolved", "closed"],
    "escalated":         ["investigating", "resolved", "closed"],
    "resolved":          ["closed", "investigating"],  # Can reopen
    "closed":            [],  # Terminal
}

def transition_case(case: dict, new_status: str, by: str, reason: str = "") -> dict:
    """Transition a case to a new status. Returns updated case or raises ValueError."""
    current = case["status"]
    if new_status not in ALLOWED_TRANSITIONS.get(current, []):
        raise ValueError(f"Cannot transition from '{current}' to '{new_status}'. Allowed: {ALLOWED_TRANSITIONS.get(current, [])}")

    now = datetime.now().isoformat()
    case["status"] = new_status
    case["statusHistory"].append({
        "status": new_status, "at": now, "by": by, "reason": reason
    })

    if new_status == "resolved":
        case["resolvedAt"] = now
        case["resolvedBy"] = by
        case["resolution"] = reason
    elif new_status == "closed":
        case["closedAt"] = now
        case["closedBy"] = by
    elif new_status == "escalated":
        case["escalatedAt"] = now
        case["escalationReason"] = reason

    return case


def assign_case(case: dict, assigned_to: str, by: str) -> dict:
    """Assign or reassign a case."""
    old = case.get("assignedTo")
    case["assignedTo"] = assigned_to
    case["assignedAt"] = datetime.now().isoformat()
    case["statusHistory"].append({
        "status": case["status"], "at": datetime.now().isoformat(), "by": by,
        "reason": f"Assigned to {assigned_to}" + (f" (was: {old})" if old else "")
    })
    # Auto-transition open cases to investigating when assigned
    if case["status"] == "open":
        case["status"] = "investigating"
        case["statusHistory"].append({
            "status": "investigating", "at": datetime.now().isoformat(),
            "by": by, "reason": "Auto-transitioned on assignment"
        })
    return case


def add_case_note(case: dict, note_text: str, by: str) -> dict:
    """Add a note/comment to a case."""
    case["notes"].append({
        "id": str(uuid.uuid4())[:8],
        "text": note_text,
        "by": by,
        "at": datetime.now().isoformat(),
    })
    return case


def escalate_case(case: dict, escalated_to: str, reason: str, by: str) -> dict:
    """Escalate a case to a higher authority."""
    case = transition_case(case, "escalated", by, reason)
    case["escalatedTo"] = escalated_to
    return case


# ============================================================
# SLA MANAGEMENT
# ============================================================
def check_sla_status(case: dict) -> dict:
    """Check SLA status for a case. Returns SLA info with current state."""
    if case["status"] in ("resolved", "closed"):
        return {"status": "met" if not case["sla"]["breached"] else "breached_then_resolved",
                "breached": case["sla"]["breached"]}

    now = datetime.now()
    deadline = datetime.fromisoformat(case["sla"]["deadline"])
    warning = datetime.fromisoformat(case["sla"]["warningAt"])

    if now > deadline:
        case["sla"]["breached"] = True
        if not case["sla"]["breachedAt"]:
            case["sla"]["breachedAt"] = now.isoformat()
        hours_overdue = (now - deadline).total_seconds() / 3600
        return {"status": "breached", "breached": True,
                "hoursOverdue": round(hours_overdue, 1)}
    elif now > warning:
        hours_remaining = (deadline - now).total_seconds() / 3600
        return {"status": "at_risk", "breached": False,
                "hoursRemaining": round(hours_remaining, 1)}
    else:
        hours_remaining = (deadline - now).total_seconds() / 3600
        return {"status": "on_track", "breached": False,
                "hoursRemaining": round(hours_remaining, 1)}


def run_sla_sweep(cases: list) -> list:
    """Check all active cases for SLA status. Auto-escalates breached cases.
    Returns list of cases needing attention (breached or at-risk)."""
    alerts = []
    for case in cases:
        if case["status"] in ("resolved", "closed"):
            continue
        sla = check_sla_status(case)
        if sla["status"] == "breached" and case["status"] != "escalated":
            # Auto-escalate breached cases
            try:
                transition_case(case, "escalated", "system",
                              f"SLA breached — auto-escalated ({sla.get('hoursOverdue', 0):.1f}h overdue)")
                case["escalatedTo"] = "manager"
            except ValueError:
                pass  # Already in a state that can't transition to escalated
        if sla["status"] in ("breached", "at_risk"):
            alerts.append({"caseId": case["id"], "title": case["title"],
                          "priority": case["priority"], "assignedTo": case.get("assignedTo"),
                          "slaStatus": sla["status"],
                          "detail": sla})
    return alerts


# ============================================================
# CASE DASHBOARD METRICS
# ============================================================
def compute_case_metrics(cases: list, users: list = None) -> dict:
    """Compute case management dashboard metrics."""
    active = [c for c in cases if c["status"] not in ("resolved", "closed")]
    resolved = [c for c in cases if c["status"] == "resolved"]
    closed = [c for c in cases if c["status"] == "closed"]

    # Status distribution
    by_status = {}
    for c in cases:
        by_status[c["status"]] = by_status.get(c["status"], 0) + 1

    # Priority distribution (active only)
    by_priority = {}
    for c in active:
        by_priority[c["priority"]] = by_priority.get(c["priority"], 0) + 1

    # Assignment distribution
    unassigned = [c for c in active if not c.get("assignedTo")]
    by_assignee = {}
    for c in active:
        assignee = c.get("assignedTo") or "Unassigned"
        by_assignee[assignee] = by_assignee.get(assignee, 0) + 1

    # SLA metrics
    sla_breached = [c for c in active if c.get("sla", {}).get("breached")]
    sla_at_risk = []
    for c in active:
        sla = check_sla_status(c)
        if sla["status"] == "at_risk":
            sla_at_risk.append(c)

    # Resolution time (for resolved/closed cases)
    resolution_times = []
    for c in resolved + closed:
        if c.get("resolvedAt") and c.get("createdAt"):
            try:
                created = datetime.fromisoformat(c["createdAt"])
                resolved_at = datetime.fromisoformat(c["resolvedAt"])
                hours = (resolved_at - created).total_seconds() / 3600
                resolution_times.append(hours)
            except:
                pass

    avg_resolution = round(sum(resolution_times) / len(resolution_times), 1) if resolution_times else 0

    # Total amount at risk from active cases
    total_at_risk = sum(float(c.get("amountAtRisk") or 0) for c in active)

    # Type distribution
    by_type = {}
    for c in cases:
        by_type[c["type"]] = by_type.get(c["type"], 0) + 1

    return {
        "total": len(cases),
        "active": len(active),
        "resolved": len(resolved),
        "closed": len(closed),
        "unassigned": len(unassigned),
        "byStatus": by_status,
        "byPriority": by_priority,
        "byAssignee": by_assignee,
        "byType": by_type,
        "sla": {
            "breached": len(sla_breached),
            "atRisk": len(sla_at_risk),
            "onTrack": len(active) - len(sla_breached) - len(sla_at_risk),
        },
        "avgResolutionHours": avg_resolution,
        "totalAmountAtRisk": round(total_at_risk, 2),
    }


# ============================================================
# CASE-ANOMALY SYNC
# ============================================================
def sync_case_on_anomaly_resolve(anomaly_id: str, cases: list, anomalies: list) -> list:
    """When an anomaly is resolved/dismissed, check if the parent case can be auto-resolved.
    Returns list of case IDs that were auto-resolved."""
    auto_resolved = []
    for case in cases:
        if anomaly_id not in case.get("anomalyIds", []):
            continue
        if case["status"] in ("resolved", "closed"):
            continue

        # Check if ALL anomalies in this case are now resolved/dismissed
        # An anomaly must EXIST in the anomalies list AND be non-open to count as resolved.
        # Missing/orphaned anomaly IDs are treated as unresolved (safety-first).
        all_resolved = True
        for aid in case["anomalyIds"]:
            anom = next((a for a in anomalies if a["id"] == aid), None)
            if anom is None:
                # Orphan: anomaly ID not found — treat as unresolved for safety
                all_resolved = False
                break
            if anom.get("status") == "open":
                all_resolved = False
                break

        if all_resolved:
            transition_case(case, "resolved", "system",
                          "All linked anomalies resolved/dismissed — case auto-resolved")
            auto_resolved.append(case["id"])

    return auto_resolved
