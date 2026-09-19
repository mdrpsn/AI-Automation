"""Render a PayStub to a one-page PDF using reportlab."""
from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet

from .models import PayStub

COMPANY_NAME = "Acme Trading Co."


def _money(value: float) -> str:
    return f"P{value:,.2f}"


def generate_pay_stub_pdf(stub: PayStub, output_dir: str | Path) -> Path:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{stub.employee.employee_id}_{stub.period_start.isoformat()}_{stub.period_end.isoformat()}.pdf"
    filepath = output_dir / filename

    styles = getSampleStyleSheet()
    doc = SimpleDocTemplate(str(filepath), pagesize=letter, topMargin=0.6 * inch, bottomMargin=0.6 * inch)
    story = []

    story.append(Paragraph(COMPANY_NAME, styles["Title"]))
    story.append(Paragraph("Pay Stub", styles["Heading2"]))
    story.append(Paragraph(f"Pay period: {stub.period_start} to {stub.period_end} &mdash; {stub.cutoff_label}", styles["Normal"]))
    story.append(Spacer(1, 12))

    employee_info = [
        ["Employee", stub.employee.full_name],
        ["Employee ID", stub.employee.employee_id],
        ["Position", stub.employee.position],
        ["Pay type", f"{stub.employee.pay_type.value} ({_money(stub.employee.rate)})"],
    ]
    story.append(Table(employee_info, colWidths=[1.7 * inch, 4 * inch]))
    story.append(Spacer(1, 16))

    attendance = [
        ["Regular hours", f"{stub.regular_hours:.2f}"],
        ["Overtime hours", f"{stub.overtime_hours:.2f}"],
        ["Days present", str(stub.days_present)],
        ["Days absent", str(stub.days_absent)],
        ["Late (minutes)", str(stub.late_minutes)],
    ]
    story.append(Paragraph("Attendance", styles["Heading3"]))
    story.append(Table(attendance, colWidths=[1.7 * inch, 4 * inch]))
    story.append(Spacer(1, 16))

    d = stub.deductions
    earnings_deductions = [
        ["Earnings / Deductions", "Amount"],
        ["Gross pay", _money(stub.gross_pay)],
        ["SSS", _money(-d.sss_employee)],
        ["PhilHealth", _money(-d.philhealth_employee)],
        ["Pag-IBIG", _money(-d.pagibig_employee)],
        ["Withholding tax", _money(-d.withholding_tax)],
        ["Late/undertime", _money(-d.late_undertime_deduction)],
        ["Absences", _money(-d.absence_deduction)],
        ["NET PAY", _money(stub.net_pay)],
    ]
    table = Table(earnings_deductions, colWidths=[3 * inch, 2.7 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#2b2b2b")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTNAME", (0, -1), (-1, -1), "Helvetica-Bold"),
                ("LINEABOVE", (0, -1), (-1, -1), 1, colors.black),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]
        )
    )
    story.append(Paragraph("Earnings & Deductions", styles["Heading3"]))
    story.append(table)
    story.append(Spacer(1, 16))

    ytd = [
        ["Year-to-date (before this run)", ""],
        ["Gross pay", _money(stub.ytd_gross_before)],
        ["Withholding tax", _money(stub.ytd_tax_before)],
        ["Net pay", _money(stub.ytd_net_before)],
        ["Year-to-date (after this run)", ""],
        ["Gross pay", _money(stub.ytd_gross_after)],
        ["Withholding tax", _money(stub.ytd_tax_after)],
        ["Net pay", _money(stub.ytd_net_after)],
    ]
    story.append(Paragraph("Year-to-Date", styles["Heading3"]))
    story.append(Table(ytd, colWidths=[3 * inch, 2.7 * inch]))

    if stub.warnings:
        story.append(Spacer(1, 16))
        story.append(Paragraph("Notes", styles["Heading3"]))
        for warning in stub.warnings:
            story.append(Paragraph(f"&bull; {warning}", styles["Normal"]))

    doc.build(story)
    return filepath
