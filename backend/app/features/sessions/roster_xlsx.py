from __future__ import annotations

import io
import posixpath
import re
import unicodedata
import zipfile
from dataclasses import dataclass
from xml.etree import ElementTree
from xml.sax.saxutils import escape

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
DOC_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
MAX_WORKBOOK_BYTES = 5 * 1024 * 1024
MAX_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
MAX_ROSTER_ROWS = 500


@dataclass(frozen=True, slots=True)
class RosterRow:
    row_number: int
    candidate_code: str
    full_name: str
    class_name: str | None
    seat_code: str


class RosterWorkbookError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


def _header_key(value: str) -> str:
    ascii_value = "".join(
        character
        for character in unicodedata.normalize("NFD", value.lower().strip())
        if not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]+", "_", ascii_value).strip("_")


HEADER_ALIASES = {
    "candidate_code": {"candidate_code", "ma_thi_sinh", "so_bao_danh", "sbd"},
    "full_name": {"full_name", "ho_ten", "ho_va_ten", "ten_thi_sinh"},
    "class_name": {"class_name", "lop", "lop_hoc"},
    "seat_code": {"seat_code", "ma_ghe", "ghe", "cho_ngoi"},
}


def _column_index(reference: str) -> int:
    letters = re.match(r"[A-Za-z]+", reference)
    if letters is None:
        return 0
    value = 0
    for character in letters.group(0).upper():
        value = value * 26 + ord(character) - ord("A") + 1
    return value - 1


def _cell_text(cell: ElementTree.Element, shared_strings: list[str]) -> str:
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in cell.findall(f".//{{{MAIN_NS}}}t"))
    value = cell.find(f"{{{MAIN_NS}}}v")
    raw = "" if value is None or value.text is None else value.text
    if cell_type == "s" and raw:
        try:
            return shared_strings[int(raw)]
        except (IndexError, ValueError) as error:
            raise RosterWorkbookError(
                "INVALID_XLSX", "Tệp XLSX có chuỗi tham chiếu không hợp lệ"
            ) from error
    if cell_type == "b":
        return "TRUE" if raw == "1" else "FALSE"
    return raw


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    except KeyError:
        return []
    return [
        "".join(node.text or "" for node in item.findall(f".//{{{MAIN_NS}}}t"))
        for item in root.findall(f"{{{MAIN_NS}}}si")
    ]


def _first_sheet_path(archive: zipfile.ZipFile) -> str:
    workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
    sheet = workbook.find(f".//{{{MAIN_NS}}}sheet")
    if sheet is None:
        raise RosterWorkbookError("INVALID_XLSX", "Tệp XLSX không có worksheet")
    relationship_id = sheet.attrib.get(f"{{{DOC_REL_NS}}}id")
    relationships = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    for relationship in relationships.findall(f"{{{PACKAGE_REL_NS}}}Relationship"):
        if relationship.attrib.get("Id") != relationship_id:
            continue
        target = relationship.attrib.get("Target", "")
        if target.startswith("/"):
            return target.lstrip("/")
        return posixpath.normpath(posixpath.join("xl", target))
    raise RosterWorkbookError("INVALID_XLSX", "Không tìm thấy worksheet đầu tiên")


def _row_value(values: list[str], indexes: dict[str, int], field: str) -> str:
    index = indexes.get(field)
    return values[index].strip() if index is not None and index < len(values) else ""


def parse_roster_workbook(content: bytes) -> list[RosterRow]:
    if not content:
        raise RosterWorkbookError("EMPTY_XLSX", "Tệp XLSX đang trống")
    if len(content) > MAX_WORKBOOK_BYTES:
        raise RosterWorkbookError("XLSX_TOO_LARGE", "Tệp XLSX không được vượt quá 5 MB")
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            if sum(item.file_size for item in archive.infolist()) > MAX_UNCOMPRESSED_BYTES:
                raise RosterWorkbookError("XLSX_TOO_LARGE", "Nội dung giải nén của XLSX quá lớn")
            shared_strings = _shared_strings(archive)
            sheet = ElementTree.fromstring(archive.read(_first_sheet_path(archive)))
    except RosterWorkbookError:
        raise
    except (KeyError, ElementTree.ParseError, zipfile.BadZipFile) as error:
        raise RosterWorkbookError("INVALID_XLSX", "Tệp không phải XLSX hợp lệ") from error

    raw_rows: list[tuple[int, list[str]]] = []
    for row in sheet.findall(f".//{{{MAIN_NS}}}row"):
        values: dict[int, str] = {}
        for cell in row.findall(f"{{{MAIN_NS}}}c"):
            column = _column_index(cell.attrib.get("r", "A1"))
            values[column] = _cell_text(cell, shared_strings).strip()
        if not any(values.values()):
            continue
        width = max(values, default=-1) + 1
        row_number = int(row.attrib.get("r", len(raw_rows) + 1))
        raw_rows.append((row_number, [values.get(i, "") for i in range(width)]))
    if not raw_rows:
        raise RosterWorkbookError("EMPTY_XLSX", "Worksheet đầu tiên không có dữ liệu")

    header_row, headers = raw_rows[0]
    indexes: dict[str, int] = {}
    for index, header in enumerate(headers):
        key = _header_key(header)
        for field, aliases in HEADER_ALIASES.items():
            if key in aliases and field not in indexes:
                indexes[field] = index
                break
    required = ("candidate_code", "full_name", "seat_code")
    missing = [field for field in required if field not in indexes]
    if missing:
        raise RosterWorkbookError(
            "MISSING_XLSX_COLUMNS",
            "Thiếu cột bắt buộc: Mã thí sinh, Họ tên hoặc Mã ghế",
            {"header_row": header_row, "missing": missing},
        )

    parsed: list[RosterRow] = []
    seen_candidates: dict[str, int] = {}
    seen_seats: dict[str, int] = {}
    for row_number, values in raw_rows[1:]:
        candidate_code = _row_value(values, indexes, "candidate_code").upper()
        full_name = _row_value(values, indexes, "full_name")
        class_name = _row_value(values, indexes, "class_name") or None
        seat_code = _row_value(values, indexes, "seat_code").upper()
        if not any((candidate_code, full_name, class_name, seat_code)):
            continue
        if not candidate_code or not full_name or not seat_code:
            raise RosterWorkbookError(
                "INVALID_XLSX_ROW",
                f"Dòng {row_number} phải có Mã thí sinh, Họ tên và Mã ghế",
                {"row": row_number},
            )
        if len(candidate_code) > 100 or len(full_name) > 255 or len(seat_code) > 100:
            raise RosterWorkbookError(
                "INVALID_XLSX_ROW",
                f"Dòng {row_number} có dữ liệu vượt quá độ dài cho phép",
                {"row": row_number},
            )
        if candidate_code in seen_candidates:
            raise RosterWorkbookError(
                "DUPLICATE_CANDIDATE_IN_XLSX",
                f"Mã thí sinh {candidate_code} bị lặp ở dòng {row_number}",
                {"row": row_number, "first_row": seen_candidates[candidate_code]},
            )
        if seat_code in seen_seats:
            raise RosterWorkbookError(
                "DUPLICATE_SEAT_IN_XLSX",
                f"Mã ghế {seat_code} bị lặp ở dòng {row_number}",
                {"row": row_number, "first_row": seen_seats[seat_code]},
            )
        seen_candidates[candidate_code] = row_number
        seen_seats[seat_code] = row_number
        parsed.append(RosterRow(row_number, candidate_code, full_name, class_name, seat_code))
        if len(parsed) > MAX_ROSTER_ROWS:
            raise RosterWorkbookError(
                "TOO_MANY_XLSX_ROWS",
                f"Danh sách không được vượt quá {MAX_ROSTER_ROWS} thí sinh",
            )
    if not parsed:
        raise RosterWorkbookError("EMPTY_XLSX", "XLSX chưa có dòng thí sinh nào")
    return parsed


def build_roster_workbook(rows: tuple[tuple[str, ...], ...]) -> bytes:
    sheet_rows = []
    for row_index, row in enumerate(rows, start=1):
        cells = []
        for column_index, value in enumerate(row, start=1):
            number = column_index
            letters = ""
            while number:
                number, remainder = divmod(number - 1, 26)
                letters = chr(ord("A") + remainder) + letters
            cells.append(
                f'<c r="{letters}{row_index}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
            )
        sheet_rows.append(f'<row r="{row_index}">{"".join(cells)}</row>')
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<worksheet xmlns="{MAIN_NS}"><sheetData>{"".join(sheet_rows)}</sheetData></worksheet>'
    )
    files = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" '
            'ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.'
            'spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.'
            'spreadsheetml.worksheet+xml"/>'
            '</Types>'
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<Relationships xmlns="{PACKAGE_REL_NS}">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/officeDocument" Target="xl/workbook.xml"/>'
            '</Relationships>'
        ),
        "xl/workbook.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<workbook xmlns="{MAIN_NS}" xmlns:r="{DOC_REL_NS}">'
            '<sheets><sheet name="Danh sach thi sinh" sheetId="1" r:id="rId1"/></sheets></workbook>'
        ),
        "xl/_rels/workbook.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<Relationships xmlns="{PACKAGE_REL_NS}">'
            '<Relationship Id="rId1" '
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/'
            'relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            '</Relationships>'
        ),
        "xl/worksheets/sheet1.xml": sheet_xml,
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for path, content in files.items():
            archive.writestr(path, content)
    return output.getvalue()
