import os
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors


def safe_text(value):
    if value is None:
        return "-"
    if isinstance(value, list):
        return "<br/>".join([f"• {str(item)}" for item in value])
    return str(value)


def generate_pdf_report(job_id: str, result: dict, output_dir: str) -> str:
    os.makedirs(output_dir, exist_ok=True)

    file_name = result.get("file_name", "-")
    chair = result.get("chair_decision", {})
    scientific = result.get("scientific_review", {})
    commercial = result.get("commercial_review", {})
    risk = result.get("risk_review", {})
    integrity = result.get("integrity_review", {})

    pdf_path = os.path.join(output_dir, f"{job_id}-executive-report.pdf")

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        rightMargin=1.6 * cm,
        leftMargin=1.6 * cm,
        topMargin=1.6 * cm,
        bottomMargin=1.6 * cm,
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        "TitleStyle",
        parent=styles["Title"],
        fontSize=22,
        leading=28,
        spaceAfter=14,
        textColor=colors.HexColor("#0f172a"),
    )

    h2_style = ParagraphStyle(
        "H2Style",
        parent=styles["Heading2"],
        fontSize=14,
        leading=18,
        spaceBefore=12,
        spaceAfter=8,
        textColor=colors.HexColor("#1e3a8a"),
    )

    body_style = ParagraphStyle(
        "BodyStyle",
        parent=styles["BodyText"],
        fontSize=9.5,
        leading=14,
        textColor=colors.HexColor("#1f2937"),
    )

    small_style = ParagraphStyle(
        "SmallStyle",
        parent=styles["BodyText"],
        fontSize=8.5,
        leading=12,
        textColor=colors.HexColor("#475569"),
    )

    story = []

    story.append(Paragraph("ReviewerOS Executive Evaluation Report", title_style))
    story.append(Paragraph(f"<b>Application:</b> {safe_text(file_name)}", body_style))
    story.append(Paragraph(f"<b>Job ID:</b> {safe_text(job_id)}", small_style))
    story.append(Spacer(1, 12))

    summary_table_data = [
        ["Final Score", safe_text(chair.get("final_score"))],
        ["Recommendation", safe_text(chair.get("recommendation"))],
        ["Confidence", safe_text(chair.get("confidence"))],
        ["Risk Severity", safe_text(risk.get("risk_level", risk.get("score")))],
        ["AI-Generated Likelihood", safe_text(integrity.get("ai_generated_likelihood"))],
        ["Integrity Score", safe_text(integrity.get("integrity_score"))],
    ]

    table = Table(summary_table_data, colWidths=[6 * cm, 10 * cm])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#e2e8f0")),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#0f172a")),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("PADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    story.append(table)
    story.append(Spacer(1, 14))

    story.append(Paragraph("Executive Summary", h2_style))
    story.append(Paragraph(safe_text(chair.get("summary")), body_style))

    story.append(Paragraph("Top Strengths", h2_style))
    story.append(Paragraph(safe_text(chair.get("top_strengths")), body_style))

    story.append(Paragraph("Top Weaknesses", h2_style))
    story.append(Paragraph(safe_text(chair.get("top_weaknesses")), body_style))

    story.append(Paragraph("Top Risks", h2_style))
    story.append(Paragraph(safe_text(chair.get("top_risks")), body_style))

    story.append(Paragraph("Integrity Notes", h2_style))
    story.append(Paragraph(safe_text(chair.get("integrity_notes")), body_style))

    story.append(Paragraph("Reviewer Scores", h2_style))

    reviewer_table_data = [
        ["Reviewer", "Score", "Confidence"],
        ["Scientific", safe_text(scientific.get("score")), safe_text(scientific.get("confidence"))],
        ["Commercial", safe_text(commercial.get("score")), safe_text(commercial.get("confidence"))],
        ["Risk", safe_text(risk.get("score")), safe_text(risk.get("confidence"))],
        ["Integrity", safe_text(integrity.get("integrity_score")), safe_text(integrity.get("confidence"))],
    ]

    reviewer_table = Table(reviewer_table_data, colWidths=[6 * cm, 5 * cm, 5 * cm])
    reviewer_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#cbd5e1")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("PADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    story.append(reviewer_table)

    story.append(Paragraph("Final Feedback", h2_style))
    story.append(Paragraph(safe_text(chair.get("final_feedback")), body_style))

    doc.build(story)

    return pdf_path