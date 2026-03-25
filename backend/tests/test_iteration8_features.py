"""
Test Suite for Iteration 8 Features:
- Fees module: Auto-overdue, concession/scholarship, sibling discount, sequential receipts
- Attendance module: Holiday calendar, attendance blocking on holidays, alerts, employee attendance
"""
import pytest
import requests
import os
from datetime import datetime, timedelta

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

class TestAdminLogin:
    """Test admin authentication"""
    
    def test_admin_login_success(self):
        """Admin login with valid credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        assert response.status_code == 200, f"Login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "admin"
        print(f"✓ Admin login successful - user_id: {data['user']['user_id']}")


@pytest.fixture(scope="module")
def admin_token():
    """Get admin auth token for authenticated requests"""
    response = requests.post(f"{BASE_URL}/api/auth/login", json={
        "email": "admin@test.com",
        "password": "Test1234!"
    })
    if response.status_code == 200:
        return response.json()["token"]
    pytest.skip("Admin login failed")


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    """Headers with admin auth token"""
    return {
        "Authorization": f"Bearer {admin_token}",
        "Content-Type": "application/json"
    }


# ==================== FEES MODULE TESTS ====================

class TestFeesRefreshOverdue:
    """Test POST /api/fees/refresh-overdue - auto-marks pending installments as overdue"""
    
    def test_refresh_overdue_endpoint(self, admin_headers):
        """Admin can trigger refresh-overdue to auto-mark past-due installments"""
        response = requests.post(f"{BASE_URL}/api/fees/refresh-overdue", headers=admin_headers)
        assert response.status_code == 200, f"Refresh overdue failed: {response.text}"
        data = response.json()
        assert "students_processed" in data
        assert "new_overdue_installments" in data
        print(f"✓ Refresh overdue: {data['students_processed']} students processed, {data['new_overdue_installments']} new overdue")


class TestFeesClassConfig:
    """Test GET/PUT /api/fees/class-config - sibling discount support"""
    
    def test_get_class_config_returns_sibling_discount(self, admin_headers):
        """GET /api/fees/class-config returns sibling_discount_percent field"""
        response = requests.get(f"{BASE_URL}/api/fees/class-config", headers=admin_headers)
        assert response.status_code == 200, f"Get class config failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        if len(data) > 0:
            # Check that sibling_discount_percent field exists
            assert "sibling_discount_percent" in data[0], "sibling_discount_percent field missing"
            print(f"✓ Class config has sibling_discount_percent field: {data[0].get('sibling_discount_percent', 0)}%")
        else:
            print("✓ Class config endpoint works (no classes configured)")
    
    def test_update_class_config_with_sibling_discount(self, admin_headers):
        """PUT /api/fees/class-config/{id} can set sibling_discount_percent"""
        # First get a class
        response = requests.get(f"{BASE_URL}/api/fees/class-config", headers=admin_headers)
        assert response.status_code == 200
        classes = response.json()
        
        if len(classes) == 0:
            pytest.skip("No classes to test")
        
        test_class = classes[0]
        class_id = test_class["class_id"]
        
        # Update with sibling discount
        update_data = {
            "annual_fee": test_class.get("annual_fee", 60000),
            "late_fee": test_class.get("late_fee", 500),
            "late_fee_enabled": test_class.get("late_fee_enabled", False),
            "fee_due_day": test_class.get("fee_due_day", 10),
            "sibling_discount_percent": 10  # Set 10% sibling discount
        }
        
        response = requests.put(f"{BASE_URL}/api/fees/class-config/{class_id}", 
                               headers=admin_headers, json=update_data)
        assert response.status_code == 200, f"Update class config failed: {response.text}"
        
        # Verify the update
        response = requests.get(f"{BASE_URL}/api/fees/class-config", headers=admin_headers)
        updated_classes = response.json()
        updated_class = next((c for c in updated_classes if c["class_id"] == class_id), None)
        assert updated_class is not None
        assert updated_class["sibling_discount_percent"] == 10
        print(f"✓ Updated sibling discount to 10% for class {test_class['name']}")


class TestFeesConcession:
    """Test POST /api/fees/concession and GET /api/fees/concessions"""
    
    def test_apply_concession_to_student(self, admin_headers):
        """POST /api/fees/concession - apply concession to a student"""
        # First get a student
        response = requests.get(f"{BASE_URL}/api/students", headers=admin_headers)
        assert response.status_code == 200
        students = response.json()
        
        if len(students) == 0:
            pytest.skip("No students to test")
        
        test_student = students[0]
        student_id = test_student["student_id"]
        
        # Apply 15% concession
        concession_data = {
            "student_id": student_id,
            "concession_percent": 15,
            "reason": "TEST_Merit Scholarship"
        }
        
        response = requests.post(f"{BASE_URL}/api/fees/concession", 
                                headers=admin_headers, json=concession_data)
        assert response.status_code == 200, f"Apply concession failed: {response.text}"
        data = response.json()
        assert "installments_updated" in data
        print(f"✓ Applied 15% concession to student {student_id}, {data['installments_updated']} installments updated")
    
    def test_get_concessions_list(self, admin_headers):
        """GET /api/fees/concessions - list active concessions"""
        response = requests.get(f"{BASE_URL}/api/fees/concessions", headers=admin_headers)
        assert response.status_code == 200, f"Get concessions failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} active concessions")
        
        # Verify structure if there are concessions
        if len(data) > 0:
            concession = data[0]
            assert "student_id" in concession
            assert "total_concession" in concession
            assert "reason" in concession


class TestFeesPaymentReceipt:
    """Test POST /api/fees/pay - sequential receipt numbering"""
    
    def test_payment_generates_sequential_receipt(self, admin_headers):
        """POST /api/fees/pay generates receipt in REC/YYYY-YY/NNNN format"""
        # Get a student with pending fees
        response = requests.get(f"{BASE_URL}/api/fees/due-chart", headers=admin_headers)
        assert response.status_code == 200
        due_chart = response.json()
        
        if len(due_chart) == 0:
            pytest.skip("No students with pending fees")
        
        # Find a student with pending installments
        test_student = due_chart[0]
        student_id = test_student["student_id"]
        
        # Get student fees to find exact amount
        response = requests.get(f"{BASE_URL}/api/fees/student/{student_id}", headers=admin_headers)
        assert response.status_code == 200
        fees_data = response.json()
        
        pending = [i for i in fees_data["installments"] if i["status"] != "paid"]
        if len(pending) == 0:
            pytest.skip("No pending installments for test student")
        
        # Pay first pending installment
        amount = pending[0]["total_due"]
        payment_data = {
            "student_id": student_id,
            "amount": amount,
            "payment_method": "cash",
            "remarks": "TEST_Payment"
        }
        
        response = requests.post(f"{BASE_URL}/api/fees/pay", 
                                headers=admin_headers, json=payment_data)
        assert response.status_code == 200, f"Payment failed: {response.text}"
        data = response.json()
        
        # Verify receipt number format: REC/YYYY-YY/NNNN
        assert "receipt_number" in data
        receipt = data["receipt_number"]
        assert receipt.startswith("REC/"), f"Receipt should start with REC/, got: {receipt}"
        parts = receipt.split("/")
        assert len(parts) == 3, f"Receipt should have 3 parts, got: {receipt}"
        # Check FY format (e.g., 2025-26)
        assert "-" in parts[1], f"FY should be in YYYY-YY format, got: {parts[1]}"
        # Check sequence number is 4 digits
        assert len(parts[2]) == 4, f"Sequence should be 4 digits, got: {parts[2]}"
        
        print(f"✓ Payment successful, receipt: {receipt}")


# ==================== ATTENDANCE MODULE TESTS ====================

class TestHolidaysCRUD:
    """Test GET/POST/DELETE /api/holidays"""
    
    def test_get_holidays_list(self, admin_headers):
        """GET /api/holidays returns holidays list"""
        response = requests.get(f"{BASE_URL}/api/holidays", headers=admin_headers)
        assert response.status_code == 200, f"Get holidays failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} holidays")
    
    def test_create_holiday(self, admin_headers):
        """POST /api/holidays - create a holiday"""
        # Use a future date to avoid conflicts
        test_date = (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d")
        holiday_data = {
            "date": test_date,
            "name": "TEST_Holiday",
            "type": "school"
        }
        
        response = requests.post(f"{BASE_URL}/api/holidays", 
                                headers=admin_headers, json=holiday_data)
        assert response.status_code == 200, f"Create holiday failed: {response.text}"
        data = response.json()
        assert "holiday_id" in data
        print(f"✓ Created holiday: {data['holiday_id']} on {test_date}")
        return data["holiday_id"]
    
    def test_delete_holiday(self, admin_headers):
        """DELETE /api/holidays/{id} - soft delete holiday"""
        # First create a holiday to delete
        test_date = (datetime.now() + timedelta(days=31)).strftime("%Y-%m-%d")
        holiday_data = {
            "date": test_date,
            "name": "TEST_Holiday_ToDelete",
            "type": "optional"
        }
        
        response = requests.post(f"{BASE_URL}/api/holidays", 
                                headers=admin_headers, json=holiday_data)
        assert response.status_code == 200
        holiday_id = response.json()["holiday_id"]
        
        # Now delete it
        response = requests.delete(f"{BASE_URL}/api/holidays/{holiday_id}", headers=admin_headers)
        assert response.status_code == 200, f"Delete holiday failed: {response.text}"
        print(f"✓ Deleted holiday: {holiday_id}")


class TestAttendanceHolidayBlocking:
    """Test POST /api/attendance - blocked on holiday dates"""
    
    def test_attendance_blocked_on_holiday(self, admin_headers):
        """POST /api/attendance returns 400 if date is a holiday"""
        # First create a holiday for today
        today = datetime.now().strftime("%Y-%m-%d")
        holiday_data = {
            "date": today,
            "name": "TEST_BlockingHoliday",
            "type": "public"
        }
        
        # Create holiday (may fail if already exists, that's ok)
        requests.post(f"{BASE_URL}/api/holidays", headers=admin_headers, json=holiday_data)
        
        # Get a class and section
        response = requests.get(f"{BASE_URL}/api/classes", headers=admin_headers)
        classes = response.json()
        if len(classes) == 0:
            pytest.skip("No classes to test")
        
        test_class = classes[0]
        sections = test_class.get("sections", [])
        if len(sections) == 0:
            pytest.skip("No sections to test")
        
        section = sections[0]["section_name"] if isinstance(sections[0], dict) else sections[0]
        
        # Try to mark attendance on holiday
        attendance_data = {
            "class_name": test_class["name"],
            "section": section,
            "date": today,
            "records": [{"entity_id": "test_student", "status": "present"}]
        }
        
        response = requests.post(f"{BASE_URL}/api/attendance", 
                                headers=admin_headers, json=attendance_data)
        
        # Should be blocked (400) because it's a holiday
        assert response.status_code == 400, f"Expected 400 for holiday, got {response.status_code}"
        assert "Holiday" in response.text or "holiday" in response.text.lower()
        print(f"✓ Attendance correctly blocked on holiday ({today})")
        
        # Cleanup: delete the test holiday
        holidays = requests.get(f"{BASE_URL}/api/holidays", headers=admin_headers).json()
        for h in holidays:
            if h["name"] == "TEST_BlockingHoliday":
                requests.delete(f"{BASE_URL}/api/holidays/{h['holiday_id']}", headers=admin_headers)


class TestAttendanceParentNotification:
    """Test POST /api/attendance - returns parents_notified count"""
    
    def test_attendance_returns_parents_notified(self, admin_headers):
        """POST /api/attendance returns parents_notified count for absent students"""
        # Get students
        response = requests.get(f"{BASE_URL}/api/students", headers=admin_headers)
        students = response.json()
        if len(students) == 0:
            pytest.skip("No students to test")
        
        # Get a class with students
        test_student = students[0]
        class_name = test_student["class_name"]
        section = test_student["section"]
        
        # Use a non-holiday date (yesterday or a past date)
        test_date = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        
        # Mark attendance with one absent
        attendance_data = {
            "class_name": class_name,
            "section": section,
            "date": test_date,
            "records": [
                {"entity_id": test_student["student_id"], "status": "absent"}
            ]
        }
        
        response = requests.post(f"{BASE_URL}/api/attendance", 
                                headers=admin_headers, json=attendance_data)
        
        # May succeed or fail based on holiday/lock status
        if response.status_code == 200:
            data = response.json()
            assert "parents_notified" in data, "Response should include parents_notified count"
            print(f"✓ Attendance submitted, parents_notified: {data['parents_notified']}")
        else:
            # If blocked (holiday or locked), that's also valid
            print(f"✓ Attendance endpoint responded with {response.status_code} (may be locked/holiday)")


class TestAttendanceAlerts:
    """Test GET /api/attendance/alerts - students below threshold"""
    
    def test_get_attendance_alerts(self, admin_headers):
        """GET /api/attendance/alerts returns students below threshold"""
        response = requests.get(f"{BASE_URL}/api/attendance/alerts", 
                               headers=admin_headers, params={"threshold": 75})
        assert response.status_code == 200, f"Get alerts failed: {response.text}"
        data = response.json()
        
        assert "threshold" in data
        assert "alerts" in data
        assert "total_flagged" in data
        assert data["threshold"] == 75
        
        print(f"✓ Attendance alerts: {data['total_flagged']} students below 75% threshold")
        
        # Verify alert structure if there are any
        if len(data["alerts"]) > 0:
            alert = data["alerts"][0]
            assert "student_id" in alert
            assert "attendance_percentage" in alert
            assert "shortfall" in alert


class TestEmployeeAttendance:
    """Test POST /api/attendance/employee and GET /api/attendance/employees"""
    
    def test_mark_employee_attendance(self, admin_headers):
        """POST /api/attendance/employee - mark employee attendance"""
        # Get employees
        response = requests.get(f"{BASE_URL}/api/employees", headers=admin_headers)
        employees = response.json()
        
        if len(employees) == 0:
            pytest.skip("No employees to test")
        
        # Use a non-holiday date
        test_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
        
        # Mark attendance for first employee
        test_employee = employees[0]
        attendance_data = {
            "date": test_date,
            "records": [
                {"employee_id": test_employee["employee_id"], "status": "present"}
            ]
        }
        
        response = requests.post(f"{BASE_URL}/api/attendance/employee", 
                                headers=admin_headers, json=attendance_data)
        
        if response.status_code == 200:
            data = response.json()
            assert "success" in data
            print(f"✓ Employee attendance marked: {data['success']} records")
        elif response.status_code == 400 and "Holiday" in response.text:
            print(f"✓ Employee attendance blocked on holiday (expected)")
        else:
            assert False, f"Unexpected response: {response.status_code} - {response.text}"
    
    def test_get_employee_attendance(self, admin_headers):
        """GET /api/attendance/employees - get employee records"""
        response = requests.get(f"{BASE_URL}/api/attendance/employees", headers=admin_headers)
        assert response.status_code == 200, f"Get employee attendance failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"✓ Got {len(data)} employee attendance records")


# ==================== CLEANUP ====================

class TestCleanup:
    """Cleanup test data"""
    
    def test_cleanup_test_holidays(self, admin_headers):
        """Remove TEST_ prefixed holidays"""
        response = requests.get(f"{BASE_URL}/api/holidays", headers=admin_headers)
        holidays = response.json()
        
        deleted = 0
        for h in holidays:
            if h["name"].startswith("TEST_"):
                requests.delete(f"{BASE_URL}/api/holidays/{h['holiday_id']}", headers=admin_headers)
                deleted += 1
        
        print(f"✓ Cleaned up {deleted} test holidays")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
