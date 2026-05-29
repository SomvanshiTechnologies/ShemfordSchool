from pydantic import BaseModel, Field, EmailStr, ConfigDict, model_validator
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone
import uuid


def _current_academic_year() -> str:
    """
    Return the current Indian academic year (April–March cycle).
    e.g. Jan–Mar 2026 → "2025-2026";  Apr–Dec 2026 → "2026-2027"
    Must stay in sync with routes/fees.py::current_academic_year().
    """
    now = datetime.now()
    if now.month >= 4:
        return f"{now.year}-{now.year + 1}"
    return f"{now.year - 1}-{now.year}"


class UserRole:
    ADMIN = "admin"
    TEACHER = "teacher"
    STUDENT = "student"
    PARENT = "parent"
    ACCOUNTANT = "accountant"


class FeeComponentType:
    REGISTRATION = "registration"
    ADMISSION = "admission"
    CAUTION_DEPOSIT = "caution_deposit"
    ANNUAL_CHARGE = "annual_charge"
    ACTIVITY_FEE = "activity_fee"
    EXAM_FEE = "exam_fee"
    LAB_FEE = "lab_fee"
    AI_ROBOTICS_FEE = "ai_robotics_fee"
    TUITION = "tuition"
    UPGRADATION = "upgradation"


FEE_COMPONENT_FREQUENCY = {
    "registration": "one_time",
    "admission": "one_time",
    "caution_deposit": "one_time",
    "annual_charge": "yearly",
    "activity_fee": "yearly",
    "exam_fee": "yearly",
    "lab_fee": "yearly",
    "ai_robotics_fee": "yearly",
    "tuition": "monthly",
    "upgradation": "one_time",
}

REQUIRED_DOCUMENTS = [
    {"type": "birth_certificate", "name": "Birth Certificate", "mandatory": False},
    {"type": "aadhaar_card", "name": "Aadhaar Card", "mandatory": False},
    {"type": "passport_photo", "name": "Passport Photo", "mandatory": False},
    {"type": "previous_marksheet", "name": "Previous Class Marksheet", "mandatory": False},
    {"type": "transfer_certificate", "name": "Transfer Certificate (TC)", "mandatory": False},
    {"type": "caste_certificate", "name": "Caste Certificate", "mandatory": False},
    {"type": "medical_certificate", "name": "Medical Fitness Certificate", "mandatory": False},
]

STREAMS = ["science", "humanities"]
CLASSES_WITH_STREAMS = ["11th", "12th"]

# Ordered class list for Shemford Futuristic School
SHEMFORD_CLASSES = [
    "SF. SR.", "LKG", "UKG",
    "1st", "2nd", "3rd", "4th", "5th",
    "6th", "7th", "8th", "9th", "10th",
    "11th", "12th",
]

# Rainbow sections used across all classes
SHEMFORD_SECTIONS = ["Violet", "Indigo", "Blue", "Green", "Yellow", "Orange", "Red"]


class UserBase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str = Field(default_factory=lambda: f"user_{uuid.uuid4().hex[:12]}")
    email: EmailStr
    name: str
    role: str
    phone: Optional[str] = None
    picture: Optional[str] = None
    is_active: bool = True
    last_login: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UserCreate(BaseModel):
    email: EmailStr
    name: str
    password: str
    role: str
    phone: Optional[str] = None


class UserLogin(BaseModel):
    # Login identifier: an email, a student admission number, or an employee ID.
    # Kept as a plain string (not EmailStr) so non-email identifiers validate.
    email: str
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: str
    role: str
    phone: Optional[str] = None
    picture: Optional[str] = None
    is_active: bool
    last_login: Optional[datetime] = None
    created_at: datetime


class StudentBase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    student_id: str = Field(default_factory=lambda: f"STU{datetime.now().year}{uuid.uuid4().hex[:6].upper()}")
    admission_number: str = ""
    user_id: Optional[str] = None
    first_name: str
    last_name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: str
    address: Optional[str] = None
    class_name: str
    section: str
    stream: Optional[str] = None  # "science", "arts", "commerce" — for class 11/12
    roll_number: Optional[str] = None
    parent_id: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    parent_email: Optional[EmailStr] = None
    mother_name: Optional[str] = None
    mother_phone: Optional[str] = None
    mother_email: Optional[EmailStr] = None
    admission_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    academic_year: str = Field(default_factory=_current_academic_year)
    is_active: bool = True
    fee_status: str = "pending"
    app_locked: bool = False
    is_sibling: bool = False
    sibling_student_id: Optional[str] = None
    blood_group: Optional[str] = None
    emergency_contact: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StudentCreate(BaseModel):
    first_name: str
    last_name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: str
    address: Optional[str] = None
    class_name: str
    section: str
    stream: Optional[str] = None
    roll_number: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    parent_email: Optional[EmailStr] = None
    mother_name: Optional[str] = None
    mother_phone: Optional[str] = None
    mother_email: Optional[EmailStr] = None
    is_sibling: bool = False
    sibling_student_id: Optional[str] = None
    blood_group: Optional[str] = None
    emergency_contact: Optional[str] = None


class EmployeeBase(BaseModel):
    model_config = ConfigDict(extra="ignore")
    employee_id: str = Field(default_factory=lambda: f"EMP{datetime.now().year}{uuid.uuid4().hex[:6].upper()}")
    user_id: Optional[str] = None
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: str
    address: Optional[str] = None
    designation: str
    department: str
    joining_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    date_left: Optional[str] = None  # YYYY-MM-DD when the employee left (None = still employed)
    # Salary
    salary: Optional[float] = None          # legacy field — kept for compat
    monthly_salary: float = 0.0             # canonical payroll salary
    # Bank details
    bank_account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_holder: Optional[str] = None
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EmployeeCreate(BaseModel):
    # Optional custom ID — admin may supply one, else EmployeeBase auto-generates
    employee_id: Optional[str] = None
    first_name: str
    last_name: str
    email: EmailStr
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: str
    address: Optional[str] = None
    designation: str
    department: str
    salary: Optional[float] = None
    monthly_salary: float = 0.0
    bank_account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_name: Optional[str] = None
    bank_account_holder: Optional[str] = None


# ===================== FEE MODELS (COMPONENT-BASED) =====================

class FeeComponentConfig(BaseModel):
    """
    Per-class, per-stream, per-academic-session fee component configuration.
    Defines exact amounts for each fee type. Stream only applies to class 11/12.
    """
    model_config = ConfigDict(extra="ignore")
    config_id: str = Field(default_factory=lambda: f"fcc_{uuid.uuid4().hex[:10]}")
    class_name: str
    stream: Optional[str] = None  # "science", "arts", "commerce" — for 11/12 only
    academic_year: str
    # One-time fees (collected at admission)
    registration_fee: float = 0
    admission_fee: float = 0
    caution_deposit: float = 0
    # Yearly fees (collected once per year)
    annual_charge: float = 0
    activity_fee: float = 0
    exam_fee: float = 0
    lab_fee: float = 0  # for science/computer streams and classes 1–12
    ai_robotics_fee: float = 0  # for classes IX & X only
    # Monthly fees
    monthly_tuition: float = 0
    # Upgradation (charged when moving to next class mid-year or on promotion)
    upgradation_fee: float = 0
    # Payment settings
    due_day: int = 10
    late_fee: float = 0
    late_fee_enabled: bool = False
    # Sibling discount (school policy) — fixed amounts in ₹
    sibling_admission_discount_amount: float = 0  # Fixed discount amount for admission fee for siblings
    sibling_tuition_discount_amount: float = 0    # Fixed discount amount for monthly tuition for siblings
    is_active: bool = True
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: Optional[datetime] = None


class StudentLedgerEntry(BaseModel):
    """
    One row in a student's fee ledger. Each fee component/month has its own entry.
    This is the primary source of truth for fee obligations and payments.
    """
    model_config = ConfigDict(extra="ignore")
    ledger_id: str = Field(default_factory=lambda: f"ldg_{uuid.uuid4().hex[:12]}")
    student_id: str
    admission_number: str = ""
    class_name: str
    stream: Optional[str] = None
    academic_year: str
    fee_component: str  # "tuition", "annual_charge", "admission", etc.
    fee_type: str       # "one_time", "yearly", "monthly"
    description: str    # e.g. "April 2025 Tuition", "Annual Fee 2025-26"
    month: Optional[str] = None  # "2025-04" — only for monthly fees
    gross_amount: float
    concession_amount: float = 0
    concession_reason: Optional[str] = None
    late_fee_applied: float = 0
    net_amount: float   # gross - concession + late_fee
    due_date: str
    status: str = "pending"  # pending, paid, overdue, waived, partially_paid
    payment_id: Optional[str] = None
    receipt_number: Optional[str] = None
    paid_date: Optional[str] = None
    # Partial payment support
    amount_paid: float = 0          # how much has been paid so far
    remaining_balance: float = 0    # net_amount - amount_paid (0 when fully paid)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode='after')
    def init_remaining_balance(self) -> 'StudentLedgerEntry':
        if self.remaining_balance == 0 and self.amount_paid == 0 and self.net_amount > 0:
            self.remaining_balance = self.net_amount
        return self


class StudentDocument(BaseModel):
    """Document uploaded during the admission process."""
    model_config = ConfigDict(extra="ignore")
    document_id: str = Field(default_factory=lambda: f"doc_{uuid.uuid4().hex[:12]}")
    student_id: Optional[str] = None
    onboarding_id: str
    document_type: str   # birth_certificate, aadhaar_card, passport_photo, etc.
    document_name: str
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    is_mandatory: bool = True
    status: str = "uploaded"  # uploaded, verified, rejected
    verified_by: Optional[str] = None
    verified_at: Optional[str] = None
    rejection_reason: Optional[str] = None
    uploaded_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class UpgradationRecord(BaseModel):
    """
    Tracks a student's class promotion / upgradation request.

    Workflow:
      1. Request is created with status="pending_approval" — student is NOT moved yet.
      2. Admin reviews under "Pending Approvals" and either:
         - approves → student.class/section/stream updated, fee ledger entries created,
           status="approved"
         - rejects → status="rejected", student record untouched.
    """
    model_config = ConfigDict(extra="ignore")
    upgradation_id: str = Field(default_factory=lambda: f"upg_{uuid.uuid4().hex[:10]}")
    student_id: str
    from_class: str
    to_class: str
    from_stream: Optional[str] = None
    to_stream: Optional[str] = None
    from_section: str = ""
    to_section: str = ""
    academic_year: str  # the NEW academic year after upgradation
    upgradation_fee: float = 0
    upgradation_fee_ledger_id: Optional[str] = None
    upgradation_fee_paid: bool = False
    # Approval workflow
    status: str = "pending_approval"   # pending_approval | approved | rejected
    requested_by: Optional[str] = None
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    rejection_reason: Optional[str] = None
    performed_by: str   # who initiated the request (kept for back-compat)
    notes: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===================== FEE MODELS (LEGACY — kept for backward compat) =====================

class FeeStructure(BaseModel):
    """Annual fee config per class. Admin sets annual_fee, system splits into 12 months."""
    model_config = ConfigDict(extra="ignore")
    fee_id: str = Field(default_factory=lambda: f"fee_{uuid.uuid4().hex[:12]}")
    class_name: str
    fee_type: str = "tuition"
    annual_fee: float
    monthly_amount: float = 0  # auto-calculated: annual_fee / 12
    academic_year: str = Field(default_factory=_current_academic_year)
    due_day: int = 10  # day of month when fee is due
    late_fee: float = 0  # late fee per month after due date
    late_fee_enabled: bool = False
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FeeInstallment(BaseModel):
    """One monthly installment per student. Generated when annual fee is set or student joins."""
    model_config = ConfigDict(extra="ignore")
    installment_id: str = Field(default_factory=lambda: f"inst_{uuid.uuid4().hex[:12]}")
    fee_id: str
    student_id: str
    class_name: str
    month: str  # "2025-04"
    amount: float
    late_fee_applied: float = 0
    concession_amount: float = 0
    concession_reason: Optional[str] = None
    total_due: float = 0  # amount - concession + late_fee
    status: str = "pending"  # pending, paid, overdue
    due_date: str = ""  # "2025-04-10"
    paid_date: Optional[str] = None
    payment_id: Optional[str] = None
    academic_year: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class FeePayment(BaseModel):
    """Actual payment record. One per payment transaction."""
    model_config = ConfigDict(extra="ignore")
    payment_id: str = Field(default_factory=lambda: f"pay_{uuid.uuid4().hex[:12]}")
    student_id: str
    installment_ids: List[str] = Field(default_factory=list)  # which installments this covers
    amount: float
    payment_date: str = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    payment_method: str = "cash"  # cash, online, cheque, bank_transfer
    transaction_id: Optional[str] = None
    receipt_number: str = Field(default_factory=lambda: f"RCP{datetime.now().year}{uuid.uuid4().hex[:8].upper()}")
    collected_by: Optional[str] = None
    remarks: Optional[str] = None
    academic_year: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===================== ATTENDANCE MODELS =====================

class AttendanceRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    attendance_id: str = Field(default_factory=lambda: f"att_{uuid.uuid4().hex[:12]}")
    entity_type: str = "student"
    entity_id: str
    date: str
    status: str  # present, absent, leave
    class_name: Optional[str] = None
    section: Optional[str] = None
    marked_by: Optional[str] = None
    remarks: Optional[str] = None
    is_locked: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AttendanceSession(BaseModel):
    """Tracks a teacher's attendance submission for a class/section/date."""
    model_config = ConfigDict(extra="ignore")
    session_id: str = Field(default_factory=lambda: f"attsess_{uuid.uuid4().hex[:10]}")
    class_name: str
    section: str
    stream: Optional[str] = None  # set for Class 11th/12th to separate Science vs Humanities
    date: str
    marked_by: str
    is_locked: bool = True  # locked after submission
    student_count: int = 0
    present_count: int = 0
    absent_count: int = 0
    leave_count: int = 0
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===================== EXAM & MARKS MODELS =====================

class ExamDefinition(BaseModel):
    """Admin defines an exam (Unit Test 1, Term 1, Term 2) with subjects and max marks."""
    model_config = ConfigDict(extra="ignore")
    exam_id: str = Field(default_factory=lambda: f"exam_{uuid.uuid4().hex[:10]}")
    name: str  # "Unit Test 1", "Term 1", "Term 2"
    exam_type: str  # "unit_test", "term", "annual"
    class_name: str
    academic_year: str = Field(default_factory=_current_academic_year)
    subjects: List[Dict[str, Any]] = Field(default_factory=list)  # [{"subject": "Math", "max_marks": 80}]
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    is_published: bool = False  # marks visible to parents/students only when published
    is_locked: bool = False  # locked = no more edits
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class MarkRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    mark_id: str = Field(default_factory=lambda: f"mark_{uuid.uuid4().hex[:12]}")
    student_id: str
    exam_id: str  # links to ExamDefinition
    class_name: str
    section: str
    subject: str
    exam_type: str
    term: str
    academic_year: str
    marks_obtained: float
    max_marks: float
    grade: Optional[str] = None
    remarks: Optional[str] = None
    entered_by: Optional[str] = None
    is_locked: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    @model_validator(mode="after")
    def validate_marks(self) -> "MarkRecord":
        if self.max_marks <= 0:
            raise ValueError("max_marks must be greater than 0")
        if self.marks_obtained < 0:
            raise ValueError("marks_obtained cannot be negative")
        if self.marks_obtained > self.max_marks:
            raise ValueError(
                f"marks_obtained ({self.marks_obtained}) cannot exceed max_marks ({self.max_marks})"
            )
        return self


# ===================== OTHER MODELS (UNCHANGED) =====================

class Announcement(BaseModel):
    model_config = ConfigDict(extra="ignore")
    announcement_id: str = Field(default_factory=lambda: f"ann_{uuid.uuid4().hex[:12]}")
    title: str
    content: Optional[str] = None
    target_type: str
    target_value: Optional[str] = None
    target_audiences: Optional[List[str]] = None  # subset of ["student","parent","teacher"]
    priority: str = "normal"
    announcement_type: str = "general"  # general | homework | classwork
    created_by: str
    is_active: bool = True
    voice_note_id: Optional[str] = None
    academic_year: Optional[str] = None  # session this announcement belongs to
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Syllabus(BaseModel):
    model_config = ConfigDict(extra="ignore")
    syllabus_id: str = Field(default_factory=lambda: f"syl_{uuid.uuid4().hex[:12]}")
    class_name: str
    subject: str
    title: str
    description: Optional[str] = None
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    academic_year: str
    uploaded_by: str
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Issue(BaseModel):
    model_config = ConfigDict(extra="ignore")
    issue_id: str = Field(default_factory=lambda: f"iss_{uuid.uuid4().hex[:12]}")
    title: str
    description: str
    category: str
    priority: str = "normal"
    status: str = "open"
    raised_by: str
    raised_by_role: str
    assigned_to: Optional[str] = None
    resolution: Optional[str] = None
    resolved_at: Optional[datetime] = None
    academic_year: Optional[str] = None  # session this issue belongs to
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    message_id: str = Field(default_factory=lambda: f"msg_{uuid.uuid4().hex[:12]}")
    sender_id: str
    sender_name: str
    recipient_id: Optional[str] = None
    recipient_type: str
    recipient_value: Optional[str] = None
    subject: str
    content: str
    message_type: str = "text"
    voice_url: Optional[str] = None
    voice_note_id: Optional[str] = None
    is_read: bool = False
    academic_year: Optional[str] = None  # session this message belongs to
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ClassStructure(BaseModel):
    model_config = ConfigDict(extra="ignore")
    class_id: str = Field(default_factory=lambda: f"cls_{uuid.uuid4().hex[:8]}")
    name: str           # e.g. "SF. SR.", "LKG", "1st", "11th"
    display_name: str   # e.g. "SF. SR.", "Class 1st", "Class 11th"
    sort_order: int = 0  # for ordering in UI: 0=SF.SR., 1=LKG, 2=UKG, 3=1st … 14=12th
    academic_year: str = Field(default_factory=_current_academic_year)
    # sections: list of dicts with keys: section_name, capacity, class_teacher_id, class_teacher_name
    sections: List[Dict[str, Any]] = Field(default_factory=list)
    # Streams — only for 11th and 12th
    has_streams: bool = False
    streams: List[str] = Field(default_factory=list)  # ["science", "humanities"] for 11th/12th
    annual_fee: float = 0
    late_fee: float = 0
    late_fee_enabled: bool = False
    fee_due_day: int = 10
    sibling_discount_percent: float = 0  # % discount for 2nd+ child of same parent
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===================== PAYROLL MODELS =====================

class PayrollStatus:
    DRAFT    = "draft"      # generated, not yet approved
    APPROVED = "approved"   # approved by admin, ready to pay
    PAID     = "paid"       # salary disbursed


class PayrollRecord(BaseModel):
    """
    One row = one employee's salary for one month.
    Unique constraint on (employee_id, month_year).
    """
    model_config = ConfigDict(extra="ignore")
    payroll_id: str = Field(default_factory=lambda: f"pay_{uuid.uuid4().hex[:14]}")
    employee_id: str
    month: int          # 1–12
    year: int           # e.g. 2026
    month_year: str     # "YYYY-MM" — indexed for fast queries

    # Salary snapshot at time of generation (frozen so historical records stay accurate)
    monthly_salary: float       # gross monthly salary from employee record
    per_day_salary: float       # monthly_salary / total_days_in_month

    # Day breakdown
    total_days: int             # calendar days in the month
    working_days: int           # days employee was expected to work (after mid-month join)
    lwp_days: float             # Leave Without Pay days (can be fractional)
    present_days: float         # working_days - lwp_days

    # Calculation
    gross_salary: float         # (working_days / total_days) * monthly_salary
    lwp_deduction: float        # lwp_days * per_day_salary
    other_deductions: float = 0.0
    deduction_remarks: Optional[str] = None
    total_deductions: float     # lwp_deduction + other_deductions
    net_salary: float           # gross_salary - total_deductions

    # Flags
    is_mid_month_join: bool = False   # True if employee joined this month

    # Workflow
    status: str = PayrollStatus.DRAFT
    generated_by: str
    approved_by: Optional[str] = None
    approved_at: Optional[str] = None
    paid_at: Optional[str] = None
    payment_reference: Optional[str] = None  # bank transfer ref / UTR
    remarks: Optional[str] = None

    # Bank snapshot (frozen at payment time for audit)
    bank_account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None
    bank_name: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===================== RAZORPAY MODELS =====================

class RazorpayOrderStatus:
    CREATED                     = "CREATED"
    INITIATED                   = "INITIATED"
    SUCCESS_PENDING_VERIFICATION = "SUCCESS_PENDING_VERIFICATION"
    VERIFIED_SUCCESS            = "VERIFIED_SUCCESS"
    FAILED                      = "FAILED"
    CANCELLED                   = "CANCELLED"


class RazorpayOrder(BaseModel):
    """
    Tracks the full lifecycle of one Razorpay payment attempt.
    One record per checkout session — never reused.
    """
    model_config = ConfigDict(extra="ignore")
    internal_order_id: str = Field(default_factory=lambda: f"rzpord_{uuid.uuid4().hex[:14]}")
    rzp_order_id: str                          # order_xxx returned by Razorpay API
    rzp_payment_id: Optional[str] = None       # pay_xxx — set after payment attempt
    rzp_signature: Optional[str] = None        # HMAC signature from Razorpay
    student_id: str
    ledger_ids: List[str]                      # fee ledger entries being paid
    amount_paise: int                          # amount in paise (integer, no floats)
    amount_rupees: float
    status: str = RazorpayOrderStatus.CREATED
    created_by: str
    failure_reason: Optional[str] = None
    receipt_number: Optional[str] = None
    fee_payment_id: Optional[str] = None
    # Webhook fields
    webhook_verified: bool = False
    webhook_event_id: Optional[str] = None
    # Refund fields
    refund_id: Optional[str] = None
    refund_amount: Optional[float] = None
    refund_status: Optional[str] = None
    refund_initiated_by: Optional[str] = None
    refund_initiated_at: Optional[str] = None
    # Partial payment
    is_partial: bool = False
    partial_amount_paise: Optional[int] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class AuditLog(BaseModel):
    model_config = ConfigDict(extra="ignore")
    log_id: str = Field(default_factory=lambda: f"audit_{uuid.uuid4().hex[:10]}")
    entity_type: str
    entity_id: str
    action: str
    changes: Dict[str, Any] = {}
    performed_by: str
    performed_by_name: str = ""
    performed_by_role: Optional[str] = None
    restored_at: Optional[str] = None
    restored_by: Optional[str] = None
    restored_by_name: Optional[str] = None
    academic_year: Optional[str] = None  # session this audit event belongs to
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class OnboardingApplication(BaseModel):
    model_config = ConfigDict(extra="ignore")
    onboarding_id: str = Field(default_factory=lambda: f"onb_{uuid.uuid4().hex[:10]}")
    first_name: str
    last_name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: str
    address: Optional[str] = None
    parent_name: Optional[str] = None
    parent_phone: Optional[str] = None
    parent_email: Optional[EmailStr] = None
    mother_name: Optional[str] = None
    mother_phone: Optional[str] = None
    mother_email: Optional[EmailStr] = None
    class_name: Optional[str] = None
    section: Optional[str] = None
    stream: Optional[str] = None  # for class 11/12
    academic_year: Optional[str] = None
    # Sibling info
    is_sibling: bool = False
    sibling_student_id: Optional[str] = None
    # Status flow: draft -> class_selected -> docs_uploaded -> fee_collected -> completed / rejected
    status: str = "draft"
    # Fee breakdown (all components)
    fee_breakdown: List[Dict[str, Any]] = Field(default_factory=list)
    admission_time_fee: float = 0.0   # one-time + yearly + 1st month tuition
    total_annual_fee: float = 0.0     # full year obligation
    # Document tracking
    documents_uploaded: bool = False
    documents_verified: bool = False
    # Admission fee payment
    admission_fee_paid: bool = False
    admission_fee_receipt: Optional[str] = None
    admission_fee_payment_id: Optional[str] = None
    # Completion
    admin_override: bool = False
    created_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class PasswordReset(BaseModel):
    model_config = ConfigDict(extra="ignore")
    reset_id: str = Field(default_factory=lambda: f"rst_{uuid.uuid4().hex[:12]}")
    user_id: str
    email: str
    token: str = Field(default_factory=lambda: uuid.uuid4().hex)
    expires_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc) + __import__('datetime').timedelta(hours=1))
    used: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Holiday(BaseModel):
    model_config = ConfigDict(extra="ignore")
    holiday_id: str = Field(default_factory=lambda: f"hol_{uuid.uuid4().hex[:10]}")
    date: str  # "2026-01-26"
    name: str  # "Republic Day"
    type: str = "public"  # public, school, optional
    is_active: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===================== POS PAYMENT MODELS =====================

class POSOrderStatus:
    INITIATED  = "INITIATED"
    SUCCESS    = "SUCCESS"
    FAILED     = "FAILED"
    CANCELLED  = "CANCELLED"


class POSOrder(BaseModel):
    """
    Tracks one Ezetap POS payment session.
    One record per initiation — never reused.
    Amounts stored as integer paise to avoid float rounding.
    """
    model_config = ConfigDict(extra="ignore")
    pos_order_id: str = Field(default_factory=lambda: f"posord_{uuid.uuid4().hex[:14]}")
    p2p_request_id: Optional[str] = None          # Ezetap p2pRequestId returned on initiate
    student_id: str
    ledger_ids: List[str]
    amount_paise: int                              # always integer paise
    amount_rupees: float
    device_id: str
    mode: str = "ALL"                             # ALL/UPI/CARD/CASH/BHARATQR/CHEQUE
    external_ref_number: str
    status: str = POSOrderStatus.INITIATED
    ezetap_response: Optional[Dict[str, Any]] = None  # raw JSON from Ezetap
    receipt_number: Optional[str] = None
    fee_payment_id: Optional[str] = None
    collected_by: str
    failure_reason: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ===================== VOICE NOTE MODELS =====================

class VoiceNote(BaseModel):
    """Metadata for a voice note attached to an announcement or message."""
    model_config = ConfigDict(extra="ignore")
    voice_note_id: str = Field(default_factory=lambda: f"vn_{uuid.uuid4().hex[:14]}")
    entity_type: str          # "announcement" or "message"
    entity_id: str
    uploaded_by: str
    file_path: str            # relative path under uploads/voice_notes/
    file_size: int            # bytes
    duration_seconds: Optional[float] = None
    mime_type: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
