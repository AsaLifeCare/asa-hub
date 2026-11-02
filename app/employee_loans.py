"""Employee Loans (EmployeeLoans.gs, Staff → Employee Pay) read from Postgres once the app is given to Python
(app/resource_rows.py, uploaded from the employee_loans house): one staff member's loans and payments
(employeeLoanList, staff_perf's port) and the session's own (employeeLoanMine)."""
from __future__ import annotations

from typing import Any, Callable

import locations as L
import staff_perf as SPF

APP_ID = "employee-loans"
VISITING = "Do this from your own account — not while visiting someone else."


def mine(sess: L.Session, payload: dict) -> dict[str, Any]:
    """employeeLoanMine: the session's own loans and payments, read-only but for Add Payment on its own."""
    reads = sess.reads
    g = SPF.el_gate(reads, sess.user)
    if g["visiting"] or not g["uid"]:
        return {"status": 403, "message": VISITING}
    return SPF.el_answer(SPF.el_rows(reads), lambda r: r["staff_uid"] == g["uid"], g, True, True)


ACTIONS: dict[str, Callable[[L.Session, dict], dict[str, Any]]] = {"employeeLoanList": SPF.employee_loan_list,
                                                                    "employeeLoanMine": mine}
POLICY: dict[str, dict[str, Any]] = {
    "employeeLoanList": {"roles": ("admin", "director", "manager", "staff"), "params": {"staff": "string"}},
    "employeeLoanMine": {"roles": ("admin", "director", "manager", "staff")}}
