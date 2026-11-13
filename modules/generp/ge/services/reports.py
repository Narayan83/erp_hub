from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from modules.generp.ge.config import get_settings
from modules.generp.ge.reports.page_layout import prepare_report_html


class ReportService:
    def __init__(self):
        settings = get_settings()
        self.templates_dir = Path(__file__).resolve().parent.parent / "reports" / "templates"
        self.output_dir = settings.reports_output_dir
        self.env = Environment(
            loader=FileSystemLoader(str(self.templates_dir)),
            autoescape=select_autoescape(["html", "xml"]),
        )

    def render_html(self, template_name: str, context: dict, *, bill_format: str | None = None) -> str:
        template = self.env.get_template(template_name)
        return prepare_report_html(template.render(**context), bill_format=bill_format)
