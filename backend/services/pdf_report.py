from __future__ import annotations

import os
from datetime import datetime
from typing import Any, Dict, List
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


PAGE_WIDTH, PAGE_HEIGHT = A4

NAVY = colors.HexColor("#0F172A")
SLATE = colors.HexColor("#334155")
MUTED = colors.HexColor("#64748B")
LIGHT_BG = colors.HexColor("#F8FAFC")
CARD_BG = colors.HexColor("#F1F5F9")
BORDER = colors.HexColor("#CBD5E1")
BLUE = colors.HexColor("#2563EB")
GREEN = colors.HexColor("#059669")
RED = colors.HexColor("#DC2626")
AMBER = colors.HexColor("#D97706")
PURPLE = colors.HexColor("#7C3AED")
WHITE = colors.white

NAVY_HEX = "#0F172A"
BLUE_HEX = "#2563EB"
GREEN_HEX = "#059669"
RED_HEX = "#DC2626"
AMBER_HEX = "#D97706"
PURPLE_HEX = "#7C3AED"
SLATE_HEX = "#334155"


def safe_text(value: Any, fallback: str = "-") -> str:
    if value is None:
        return fallback

    text = str(value).strip()
    return text if text else fallback


def xml_text(value: Any, fallback: str = "-") -> str:
    return escape(safe_text(value, fallback))


def safe_float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def as_list(value: Any) -> List[str]:
    if value is None:
        return []

    if isinstance(value, list):
        return [safe_text(item, "") for item in value if safe_text(item, "")]

    if isinstance(value, tuple):
        return [safe_text(item, "") for item in value if safe_text(item, "")]

    text = safe_text(value, "")
    return [text] if text else []


def bullets(items: Any, fallback: str = "No items provided.") -> str:
    values = as_list(items)

    if not values:
        return xml_text(fallback)

    return "<br/>".join(f"- {xml_text(item)}" for item in values)


def truncate_text(value: Any, max_chars: int = 180) -> str:
    text = safe_text(value, "")

    if len(text) <= max_chars:
        return text

    shortened = text[:max_chars].rsplit(" ", 1)[0]
    return f"{shortened}..."


def detail_text(value: Any, max_chars: int = 950) -> str:
    text = safe_text(value, "No rationale available.")

    if len(text) <= max_chars:
        return text

    shortened = text[:max_chars].rsplit(" ", 1)[0]
    return f"{shortened}..."


def score_hex(score: Any) -> str:
    value = safe_float(score, -1)

    if value >= 7:
        return GREEN_HEX

    if value >= 5:
        return AMBER_HEX

    if value >= 0:
        return RED_HEX

    return SLATE_HEX


def risk_hex(value: Any) -> str:
    text = safe_text(value, "").lower()
    numeric = safe_float(value, -1)

    if "high" in text or numeric >= 7:
        return RED_HEX

    if "medium" in text or numeric >= 4:
        return AMBER_HEX

    if "low" in text or numeric >= 0:
        return GREEN_HEX

    return SLATE_HEX


def get_styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()

    return {
        "section": ParagraphStyle(
            name="section",
            parent=base["Heading2"],
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=17,
            textColor=NAVY,
            spaceBefore=5,
            spaceAfter=6,
            alignment=TA_LEFT,
        ),
        "card_title": ParagraphStyle(
            name="card_title",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=10,
            leading=12,
            textColor=NAVY,
            spaceAfter=4,
        ),
        "body": ParagraphStyle(
            name="body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=8.4,
            leading=11.6,
            textColor=NAVY,
            alignment=TA_LEFT,
        ),
        "small": ParagraphStyle(
            name="small",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=7.2,
            leading=9.4,
            textColor=SLATE,
            alignment=TA_LEFT,
        ),
        "metric_label": ParagraphStyle(
            name="metric_label",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=7.2,
            leading=8.4,
            textColor=MUTED,
            alignment=TA_CENTER,
        ),
        "metric_value": ParagraphStyle(
            name="metric_value",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=14,
            leading=16.5,
            textColor=NAVY,
            alignment=TA_CENTER,
        ),
        "meta": ParagraphStyle(
            name="meta",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=7.2,
            leading=9.2,
            textColor=SLATE,
            alignment=TA_LEFT,
        ),
    }


def header_footer(canvas, doc):
    canvas.saveState()

    canvas.setFillColor(NAVY)
    canvas.rect(0, PAGE_HEIGHT - 28 * mm, PAGE_WIDTH, 28 * mm, fill=1, stroke=0)

    canvas.setFillColor(WHITE)
    canvas.setFont("Helvetica-Bold", 17)
    canvas.drawString(18 * mm, PAGE_HEIGHT - 16 * mm, "ReviewerOS")

    canvas.setFillColor(colors.HexColor("#CBD5E1"))
    canvas.setFont("Helvetica", 8.5)
    canvas.drawRightString(
        PAGE_WIDTH - 18 * mm,
        PAGE_HEIGHT - 16 * mm,
        "Autonomous AI Reviewer Panel",
    )

    canvas.setStrokeColor(colors.HexColor("#E2E8F0"))
    canvas.line(18 * mm, 14 * mm, PAGE_WIDTH - 18 * mm, 14 * mm)

    canvas.setFillColor(colors.HexColor("#94A3B8"))
    canvas.setFont("Helvetica", 7)
    canvas.drawCentredString(
        PAGE_WIDTH / 2,
        8 * mm,
        f"Generated by ReviewerOS - Page {doc.page}",
    )

    canvas.restoreState()


def metric_card(label: str, value: Any, color_hex: str = NAVY_HEX, width: float = 38 * mm) -> Table:
    styles = get_styles()

    table = Table(
        [
            [Paragraph(xml_text(label), styles["metric_label"])],
            [
                Paragraph(
                    f"<font color='{color_hex}'>{xml_text(value)}</font>",
                    styles["metric_value"],
                )
            ],
        ],
        colWidths=[width],
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )

    return table


def card(title: str, body: str, width: float) -> Table:
    styles = get_styles()

    table = Table(
        [
            [Paragraph(xml_text(title), styles["card_title"])],
            [Paragraph(body, styles["body"])],
        ],
        colWidths=[width],
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )

    return table


def section_card(title: str, text: Any) -> Table:
    styles = get_styles()

    table = Table(
        [
            [Paragraph(xml_text(title), styles["section"])],
            [Paragraph(xml_text(text, "No content available."), styles["body"])],
        ],
        colWidths=[170 * mm],
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
                ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                ("TOPPADDING", (0, 0), (-1, -1), 7),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )

    return table


def reviewer_score_value(review: Dict[str, Any], fallback: str = "-") -> Any:
    return (
        review.get("score")
        or review.get("risk_level")
        or review.get("integrity_score")
        or fallback
    )


def reviewer_detail(
    title: str,
    score: Any,
    confidence: Any,
    rationale: Any,
    accent_hex: str,
    extra_metric_label: str | None = None,
    extra_metric_value: Any | None = None,
    extra_metric_color: str = SLATE_HEX,
) -> Table:
    styles = get_styles()

    if extra_metric_label:
        metric_row = [
            metric_card("Score", score, score_hex(score), width=52 * mm),
            metric_card("Confidence", confidence, BLUE_HEX, width=52 * mm),
            metric_card(extra_metric_label, extra_metric_value, extra_metric_color, width=52 * mm),
        ]
        metric_widths = [54 * mm, 54 * mm, 54 * mm]
    else:
        metric_row = [
            metric_card("Score", score, score_hex(score), width=80 * mm),
            metric_card("Confidence", confidence, BLUE_HEX, width=80 * mm),
        ]
        metric_widths = [82 * mm, 82 * mm]

    table = Table(
        [
            [
                Paragraph(
                    f"<font color='{accent_hex}'><b>{xml_text(title)}</b></font>",
                    styles["section"],
                )
            ],
            [
                Table(
                    [metric_row],
                    colWidths=metric_widths,
                    style=TableStyle(
                        [
                            ("VALIGN", (0, 0), (-1, -1), "TOP"),
                            ("LEFTPADDING", (0, 0), (-1, -1), 0),
                            ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                        ]
                    ),
                )
            ],
            [Paragraph("<b>Reviewer Rationale</b>", styles["card_title"])],
            [Paragraph(xml_text(detail_text(rationale), "No rationale available."), styles["body"])],
        ],
        colWidths=[164 * mm],
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
                ("BOX", (0, 0), (-1, -1), 0.6, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )

    return table


def compact_meta_table(
    job_id: str,
    file_name: str,
    telemetry: Dict[str, Any],
) -> Table:
    styles = get_styles()

    meta_text = (
        f"<b>Job ID:</b> {xml_text(job_id)} &nbsp;&nbsp; "
        f"<b>File:</b> {xml_text(file_name)}<br/>"
        f"<b>Model:</b> {xml_text(telemetry.get('model'))} &nbsp;&nbsp; "
        f"<b>Tokens:</b> {xml_text(telemetry.get('tokens'))} &nbsp;&nbsp; "
        f"<b>Latency:</b> {xml_text(telemetry.get('latency_seconds'))}s &nbsp;&nbsp; "
        f"<b>Generated:</b> {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}"
    )

    table = Table(
        [[Paragraph(meta_text, styles["meta"])]],
        colWidths=[170 * mm],
    )

    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 5),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ]
        )
    )

    return table


def normalize_result_payload(result: Dict[str, Any]) -> Dict[str, Any]:
    if "result" in result and isinstance(result["result"], dict):
        return result["result"]

    return result


def build_pdf_file(
    result: Dict[str, Any],
    job_id: str,
    file_name: str,
    output_dir: str,
) -> str:
    os.makedirs(output_dir, exist_ok=True)

    normalized = normalize_result_payload(result)

    scientific = normalized.get("scientific_review", {}) or {}
    commercial = normalized.get("commercial_review", {}) or {}
    risk = normalized.get("risk_review", {}) or {}
    integrity = normalized.get("integrity_review", {}) or {}
    chair = normalized.get("chair_decision", {}) or {}
    telemetry = normalized.get("telemetry", {}) or {}

    pdf_path = os.path.join(output_dir, f"{job_id}-revieweros-executive-report.pdf")

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=36 * mm,
        bottomMargin=20 * mm,
    )

    styles = get_styles()
    story = []

    story.append(Spacer(1, 3 * mm))

    story.append(
        section_card(
            "Executive Summary",
            chair.get("summary", "No executive summary available."),
        )
    )

    story.append(Spacer(1, 5 * mm))

    metrics = Table(
        [
            [
                metric_card(
                    "Final Score",
                    chair.get("final_score", "-"),
                    score_hex(chair.get("final_score")),
                ),
                metric_card("Recommendation", chair.get("recommendation", "-"), BLUE_HEX),
                metric_card("Confidence", chair.get("confidence", "-"), BLUE_HEX),
                metric_card(
                    "Risk Severity",
                    risk.get("risk_level", "-"),
                    risk_hex(risk.get("risk_level") or risk.get("score")),
                ),
            ]
        ],
        colWidths=[42 * mm, 42 * mm, 42 * mm, 42 * mm],
    )

    metrics.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 2),
                ("RIGHTPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )

    story.append(metrics)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Decision Drivers", styles["section"]))

    driver_cards = Table(
        [
            [
                card("Top Strengths", bullets(chair.get("top_strengths")), 82 * mm),
                card("Top Weaknesses", bullets(chair.get("top_weaknesses")), 82 * mm),
            ],
            [
                card("Top Risks", bullets(chair.get("top_risks")), 82 * mm),
                card("Integrity Notes", bullets(chair.get("integrity_notes")), 82 * mm),
            ],
        ],
        colWidths=[85 * mm, 85 * mm],
    )

    driver_cards.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    story.append(driver_cards)

    story.append(PageBreak())

    story.append(Paragraph("Reviewer Matrix", styles["section"]))

    matrix = Table(
        [
            [
                Paragraph("<b>Reviewer</b>", styles["body"]),
                Paragraph("<b>Score</b>", styles["body"]),
                Paragraph("<b>Confidence</b>", styles["body"]),
                Paragraph("<b>Short View</b>", styles["body"]),
            ],
            [
                Paragraph("Scientific", styles["body"]),
                Paragraph(xml_text(scientific.get("score")), styles["body"]),
                Paragraph(xml_text(scientific.get("confidence")), styles["body"]),
                Paragraph(xml_text(truncate_text(scientific.get("justification"), 160)), styles["small"]),
            ],
            [
                Paragraph("Commercial", styles["body"]),
                Paragraph(xml_text(commercial.get("score")), styles["body"]),
                Paragraph(xml_text(commercial.get("confidence")), styles["body"]),
                Paragraph(xml_text(truncate_text(commercial.get("justification"), 160)), styles["small"]),
            ],
            [
                Paragraph("Risk", styles["body"]),
                Paragraph(xml_text(reviewer_score_value(risk)), styles["body"]),
                Paragraph(xml_text(risk.get("confidence")), styles["body"]),
                Paragraph(xml_text(truncate_text(risk.get("justification"), 160)), styles["small"]),
            ],
            [
                Paragraph("Integrity", styles["body"]),
                Paragraph(xml_text(integrity.get("integrity_score")), styles["body"]),
                Paragraph(xml_text(integrity.get("confidence")), styles["body"]),
                Paragraph(xml_text(truncate_text(integrity.get("justification"), 160)), styles["small"]),
            ],
        ],
        colWidths=[28 * mm, 20 * mm, 24 * mm, 98 * mm],
        repeatRows=1,
    )

    matrix.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("BACKGROUND", (0, 1), (-1, -1), LIGHT_BG),
                ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 4),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ]
        )
    )

    story.append(matrix)
    story.append(Spacer(1, 6 * mm))

    story.append(Paragraph("Reviewer Detail", styles["section"]))

    story.append(
        reviewer_detail(
            "Scientific Reviewer",
            scientific.get("score", "-"),
            scientific.get("confidence", "-"),
            scientific.get("justification", "-"),
            BLUE_HEX,
        )
    )

    story.append(Spacer(1, 4 * mm))

    story.append(
        reviewer_detail(
            "Commercial Reviewer",
            commercial.get("score", "-"),
            commercial.get("confidence", "-"),
            commercial.get("justification", "-"),
            GREEN_HEX,
        )
    )

    story.append(PageBreak())

    story.append(Paragraph("Risk and Integrity Detail", styles["section"]))

    story.append(
        reviewer_detail(
            "Risk Reviewer",
            reviewer_score_value(risk),
            risk.get("confidence", "-"),
            risk.get("justification", "-"),
            RED_HEX,
        )
    )

    story.append(Spacer(1, 4 * mm))

    story.append(
        reviewer_detail(
            "Integrity Reviewer",
            integrity.get("integrity_score", "-"),
            integrity.get("confidence", "-"),
            integrity.get("justification", "-"),
            PURPLE_HEX,
            extra_metric_label="AI Likelihood",
            extra_metric_value=integrity.get("ai_generated_likelihood", "-"),
            extra_metric_color=PURPLE_HEX,
        )
    )

    story.append(PageBreak())

    story.append(
        section_card(
            "Final Feedback",
            chair.get("final_feedback", "No final feedback available."),
        )
    )

    story.append(Spacer(1, 5 * mm))
    story.append(compact_meta_table(job_id=job_id, file_name=file_name, telemetry=telemetry))

    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)

    return pdf_path


def generate_pdf_report(
    job_id: str,
    result: Dict[str, Any],
    output_dir: str = "reports",
    file_name: str = "-",
) -> str:
    return build_pdf_file(
        result=result,
        job_id=job_id,
        file_name=file_name,
        output_dir=output_dir,
    )