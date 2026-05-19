import os
from typing import Any, Dict, List

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


PAGE_WIDTH, PAGE_HEIGHT = A4

DARK = colors.HexColor("#0F172A")
NAVY = colors.HexColor("#111827")
CARD = colors.HexColor("#F8FAFC")
BORDER = colors.HexColor("#CBD5E1")
TEXT = colors.HexColor("#0F172A")
MUTED = colors.HexColor("#64748B")
BLUE = colors.HexColor("#2563EB")
GREEN = colors.HexColor("#059669")
RED = colors.HexColor("#DC2626")
YELLOW = colors.HexColor("#D97706")
PURPLE = colors.HexColor("#7C3AED")


class ScoreBar(Flowable):
    def __init__(self, value: float, max_value: float = 10, width: float = 90, height: float = 8, color=BLUE):
        super().__init__()
        self.value = max(0, min(max_value, float(value or 0)))
        self.max_value = max_value
        self.width = width
        self.height = height
        self.color = color

    def draw(self):
        self.canv.setFillColor(colors.HexColor("#E2E8F0"))
        self.canv.roundRect(0, 0, self.width, self.height, 4, fill=1, stroke=0)

        fill_width = self.width * (self.value / self.max_value)
        self.canv.setFillColor(self.color)
        self.canv.roundRect(0, 0, fill_width, self.height, 4, fill=1, stroke=0)


def safe_get(data: Dict[str, Any], key: str, default: Any = "-") -> Any:
    return data.get(key, default) if isinstance(data, dict) else default


def safe_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def as_text(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def normalize_result(result: Dict[str, Any]) -> Dict[str, Any]:
    if "result" in result and isinstance(result["result"], dict):
        result = result["result"]

    return {
        "scientific_review": result.get("scientific_review", {}),
        "commercial_review": result.get("commercial_review", {}),
        "risk_review": result.get("risk_review", {}),
        "integrity_review": result.get("integrity_review", {}),
        "chair_decision": result.get("chair_decision", {}),
        "telemetry": result.get("telemetry", {}),
    }


def risk_color(risk_level: str, risk_score: Any):
    level = str(risk_level or "").lower()
    score = safe_float(risk_score, 0)

    if "high" in level or score >= 7:
        return RED
    if "medium" in level or score >= 4:
        return YELLOW
    return GREEN


def recommendation_color(recommendation: str):
    rec = str(recommendation or "").lower()

    if "advance" in rec:
        return GREEN
    if "revise" in rec:
        return YELLOW
    if "reject" in rec:
        return RED
    return BLUE


def build_styles():
    styles = getSampleStyleSheet()

    styles.add(
        ParagraphStyle(
            name="ReportTitle",
            parent=styles["Title"],
            fontName="Helvetica-Bold",
            fontSize=26,
            leading=32,
            textColor=colors.white,
            alignment=TA_LEFT,
            spaceAfter=8,
        )
    )

    styles.add(
        ParagraphStyle(
            name="ReportSubtitle",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=colors.HexColor("#CBD5E1"),
            alignment=TA_LEFT,
        )
    )

    styles.add(
        ParagraphStyle(
            name="SectionTitle",
            parent=styles["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=15,
            leading=19,
            textColor=TEXT,
            spaceBefore=14,
            spaceAfter=8,
        )
    )

    styles.add(
        ParagraphStyle(
            name="CardTitle",
            parent=styles["Heading3"],
            fontName="Helvetica-Bold",
            fontSize=12,
            leading=15,
            textColor=TEXT,
            spaceAfter=6,
        )
    )

    styles.add(
        ParagraphStyle(
            name="BodyTextCustom",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=TEXT,
            spaceAfter=6,
        )
    )

    styles.add(
        ParagraphStyle(
            name="Muted",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=11,
            textColor=MUTED,
        )
    )

    styles.add(
        ParagraphStyle(
            name="MetricLabel",
            parent=styles["Normal"],
            fontName="Helvetica",
            fontSize=8,
            leading=10,
            textColor=MUTED,
        )
    )

    styles.add(
        ParagraphStyle(
            name="MetricValue",
            parent=styles["Normal"],
            fontName="Helvetica-Bold",
            fontSize=17,
            leading=22,
            textColor=TEXT,
        )
    )

    return styles


def header_footer(canvas, doc):
    canvas.saveState()

    canvas.setFillColor(DARK)
    canvas.rect(0, PAGE_HEIGHT - 24 * mm, PAGE_WIDTH, 24 * mm, fill=1, stroke=0)

    canvas.setFont("Helvetica-Bold", 13)
    canvas.setFillColor(colors.white)
    canvas.drawString(18 * mm, PAGE_HEIGHT - 14 * mm, "ReviewerOS")

    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(colors.HexColor("#CBD5E1"))
    canvas.drawRightString(PAGE_WIDTH - 18 * mm, PAGE_HEIGHT - 14 * mm, "Autonomous AI Reviewer Panel")

    canvas.setFillColor(colors.HexColor("#F1F5F9"))
    canvas.rect(0, 0, PAGE_WIDTH, 12 * mm, fill=1, stroke=0)

    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 5 * mm, "Generated by ReviewerOS")
    canvas.drawRightString(PAGE_WIDTH - 18 * mm, 5 * mm, f"Page {doc.page}")

    canvas.restoreState()


def cover_header(job_id: str, file_name: str, chair: dict, styles):
    recommendation = safe_get(chair, "recommendation", "Review Required")
    final_score = safe_get(chair, "final_score", "-")
    confidence = safe_get(chair, "confidence", "-")
    rec_color = recommendation_color(recommendation)

    title = Paragraph("ReviewerOS Executive Evaluation Report", styles["ReportTitle"])
    subtitle = Paragraph(
        f"Application: {file_name}<br/>Job ID: {job_id}",
        styles["ReportSubtitle"],
    )

    decision_box = Table(
        [
            [
                Paragraph("Final Score", styles["MetricLabel"]),
                Paragraph("Recommendation", styles["MetricLabel"]),
                Paragraph("Confidence", styles["MetricLabel"]),
            ],
            [
                Paragraph(as_text(final_score), styles["MetricValue"]),
                Paragraph(as_text(recommendation), styles["MetricValue"]),
                Paragraph(as_text(confidence), styles["MetricValue"]),
            ],
        ],
        colWidths=[48 * mm, 62 * mm, 40 * mm],
    )

    decision_box.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("BOX", (0, 0), (-1, -1), 0.8, rec_color),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    block = Table(
        [[title], [subtitle], [Spacer(1, 8)], [decision_box]],
        colWidths=[170 * mm],
    )

    block.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), DARK),
                ("BOX", (0, 0), (-1, -1), 0, DARK),
                ("LEFTPADDING", (0, 0), (-1, -1), 14),
                ("RIGHTPADDING", (0, 0), (-1, -1), 14),
                ("TOPPADDING", (0, 0), (-1, -1), 14),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
            ]
        )
    )

    return block


def section_card(title: str, body: str, styles):
    table = Table(
        [
            [Paragraph(title, styles["CardTitle"])],
            [Paragraph(body or "-", styles["BodyTextCustom"])],
        ],
        colWidths=[170 * mm],
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CARD),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 10),
                ("RIGHTPADDING", (0, 0), (-1, -1), 10),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    return table


def bullet_list(title: str, items: List[Any], styles):
    if not items:
        items = ["No items provided."]

    body = "<br/>".join([f"- {as_text(item)}" for item in items])

    return section_card(title, body, styles)


def metric_matrix(result: Dict[str, Any], styles):
    scientific = result["scientific_review"]
    commercial = result["commercial_review"]
    risk = result["risk_review"]
    integrity = result["integrity_review"]

    risk_level = safe_get(risk, "risk_level", "Unknown")
    risk_score = safe_get(risk, "score", "-")
    risk_col = risk_color(risk_level, risk_score)

    data = [
        [
            Paragraph("Reviewer", styles["MetricLabel"]),
            Paragraph("Score", styles["MetricLabel"]),
            Paragraph("Confidence", styles["MetricLabel"]),
            Paragraph("Signal", styles["MetricLabel"]),
        ],
        [
            "Scientific",
            as_text(safe_get(scientific, "score", "-")),
            as_text(safe_get(scientific, "confidence", "-")),
            ScoreBar(safe_float(safe_get(scientific, "score", 0)), color=BLUE),
        ],
        [
            "Commercial",
            as_text(safe_get(commercial, "score", "-")),
            as_text(safe_get(commercial, "confidence", "-")),
            ScoreBar(safe_float(safe_get(commercial, "score", 0)), color=GREEN),
        ],
        [
            "Risk",
            f"{as_text(risk_score)} / {risk_level}",
            as_text(safe_get(risk, "confidence", "-")),
            ScoreBar(safe_float(risk_score), color=risk_col),
        ],
        [
            "Integrity",
            as_text(safe_get(integrity, "integrity_score", "-")),
            as_text(safe_get(integrity, "confidence", "-")),
            ScoreBar(safe_float(safe_get(integrity, "integrity_score", 0)), color=PURPLE),
        ],
    ]

    table = Table(data, colWidths=[42 * mm, 34 * mm, 34 * mm, 54 * mm])

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#E2E8F0")),
                ("TEXTCOLOR", (0, 0), (-1, 0), TEXT),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.4, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
            ]
        )
    )

    return table


def reviewer_card(name: str, review: dict, styles, is_risk: bool = False, is_integrity: bool = False):
    if is_risk:
        score_label = "Risk Score"
        score = safe_get(review, "score", "-")
        signal = safe_get(review, "risk_level", "Unknown")
    elif is_integrity:
        score_label = "Integrity Score"
        score = safe_get(review, "integrity_score", "-")
        signal = safe_get(review, "ai_generated_likelihood", "Unknown")
    else:
        score_label = "Score"
        score = safe_get(review, "score", "-")
        signal = f"Confidence {safe_get(review, 'confidence', '-')}"

    justification = safe_get(review, "justification", "No justification available.")

    table = Table(
        [
            [Paragraph(name, styles["CardTitle"])],
            [
                Table(
                    [
                        [
                            Paragraph(score_label, styles["MetricLabel"]),
                            Paragraph("Signal", styles["MetricLabel"]),
                        ],
                        [
                            Paragraph(as_text(score), styles["MetricValue"]),
                            Paragraph(as_text(signal), styles["MetricValue"]),
                        ],
                    ],
                    colWidths=[72 * mm, 72 * mm],
                )
            ],
            [Paragraph(justification, styles["BodyTextCustom"])],
        ],
        colWidths=[160 * mm],
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CARD),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("LEFTPADDING", (0, 0), (-1, -1), 9),
                ("RIGHTPADDING", (0, 0), (-1, -1), 9),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    return table


def generate_pdf_report(job_id: str, result: Dict[str, Any], output_dir: str = "reports") -> str:
    os.makedirs(output_dir, exist_ok=True)

    normalized = normalize_result(result)

    scientific = normalized["scientific_review"]
    commercial = normalized["commercial_review"]
    risk = normalized["risk_review"]
    integrity = normalized["integrity_review"]
    chair = normalized["chair_decision"]

    file_name = result.get("file_name", normalized.get("file_name", "application")) if isinstance(result, dict) else "application"

    pdf_path = os.path.join(output_dir, f"{job_id}-revieweros-executive-report.pdf")

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=32 * mm,
        bottomMargin=18 * mm,
        title="ReviewerOS Executive Report",
        author="ReviewerOS",
    )

    styles = build_styles()
    story = []

    story.append(cover_header(job_id, file_name, chair, styles))
    story.append(Spacer(1, 10))

    story.append(Paragraph("Executive Summary", styles["SectionTitle"]))
    story.append(section_card("Panel Decision", safe_get(chair, "summary", "-"), styles))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Reviewer Score Matrix", styles["SectionTitle"]))
    story.append(metric_matrix(normalized, styles))
    story.append(Spacer(1, 8))

    story.append(Paragraph("Decision Drivers", styles["SectionTitle"]))
    story.append(
        Table(
            [
                [
                    bullet_list("Top Strengths", safe_list(safe_get(chair, "top_strengths", [])), styles),
                    bullet_list("Top Weaknesses", safe_list(safe_get(chair, "top_weaknesses", [])), styles),
                ],
                [
                    bullet_list("Top Risks", safe_list(safe_get(chair, "top_risks", [])), styles),
                    bullet_list("Integrity Notes", safe_list(safe_get(chair, "integrity_notes", [])), styles),
                ],
            ],
            colWidths=[84 * mm, 84 * mm],
        )
    )

    story.append(PageBreak())

    story.append(Paragraph("Reviewer Detail", styles["SectionTitle"]))
    story.append(reviewer_card("Scientific Reviewer", scientific, styles))
    story.append(Spacer(1, 8))
    story.append(reviewer_card("Commercial Reviewer", commercial, styles))
    story.append(Spacer(1, 8))
    story.append(reviewer_card("Risk Reviewer", risk, styles, is_risk=True))
    story.append(Spacer(1, 8))
    story.append(reviewer_card("Integrity Reviewer", integrity, styles, is_integrity=True))
    story.append(Spacer(1, 10))

    story.append(Paragraph("Final Board Feedback", styles["SectionTitle"]))
    story.append(section_card("Final Feedback", safe_get(chair, "final_feedback", "-"), styles))

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)

    return pdf_path