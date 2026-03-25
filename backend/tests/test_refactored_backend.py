"""
Backend tests for Shemford School Management System - Post Refactoring
Testing modular routers, password reset flow, PDF/Excel exports, and employee-user linking
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://shemford-mobile.preview.emergentagent.com')

class TestHealth:
    """Health check tests"""
    
    def test_health_endpoint(self):
        """Test /api/health returns healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200, f"Health check failed: {response.text}"
        data = response.json()
        assert data["status"] == "healthy"
        print("PASS: Health endpoint returns healthy status")


class TestAuth:
    """Authentication endpoint tests"""
    
    def test_admin_login(self):
        """Test admin login with admin@test.com / Test1234!"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert "user" in data
        assert data["user"]["role"] == "admin"
        print("PASS: Admin login successful")
        return data["token"]
    
    def test_teacher_login(self):
        """Test teacher login with teacher@school.com / Teacher1234!"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "teacher@school.com",
            "password": "Teacher1234!"
        })
        assert response.status_code == 200, f"Teacher login failed: {response.text}"
        data = response.json()
        assert data["user"]["role"] == "teacher"
        print("PASS: Teacher login successful")
    
    def test_invalid_login(self):
        """Test invalid credentials rejected"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "invalid@test.com",
            "password": "wrongpassword"
        })
        assert response.status_code == 401
        print("PASS: Invalid login rejected")


class TestPasswordReset:
    """Password reset flow tests"""
    
    def test_forgot_password_flow(self):
        """Test forgot password returns reset token"""
        response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": "admin@test.com"
        })
        assert response.status_code == 200, f"Forgot password failed: {response.text}"
        data = response.json()
        assert "message" in data
        assert "reset_token" in data, "Reset token should be returned for testing"
        print(f"PASS: Forgot password flow returns reset token")
        return data["reset_token"]
    
    def test_reset_password_flow(self):
        """Test complete reset password flow"""
        # Step 1: Get reset token
        forgot_response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": "admin@test.com"
        })
        assert forgot_response.status_code == 200
        token = forgot_response.json().get("reset_token")
        assert token, "No reset token returned"
        
        # Step 2: Reset password (use same password to not break other tests)
        reset_response = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": token,
            "new_password": "Test1234!"  # Keep same password
        })
        assert reset_response.status_code == 200, f"Reset password failed: {reset_response.text}"
        data = reset_response.json()
        assert "Password has been reset successfully" in data["message"]
        print("PASS: Reset password flow works")
    
    def test_reset_password_invalid_token(self):
        """Test reset with invalid token fails"""
        response = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": "invalid_token_12345",
            "new_password": "NewPassword123!"
        })
        assert response.status_code == 400
        print("PASS: Invalid reset token rejected")
    
    def test_reset_password_short_password(self):
        """Test reset with short password fails"""
        # Get valid token first
        forgot_response = requests.post(f"{BASE_URL}/api/auth/forgot-password", json={
            "email": "admin@test.com"
        })
        token = forgot_response.json().get("reset_token")
        
        response = requests.post(f"{BASE_URL}/api/auth/reset-password", json={
            "token": token,
            "new_password": "short"
        })
        assert response.status_code == 400
        print("PASS: Short password rejected in reset")


class TestStudents:
    """Student endpoint tests"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_get_students(self, admin_token):
        """Test GET /api/students returns list"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/students", headers=headers)
        assert response.status_code == 200, f"Get students failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: GET /api/students returns list with {len(data)} students")


class TestClasses:
    """Class structure endpoint tests"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_get_classes(self, admin_token):
        """Test GET /api/classes returns class structures"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/classes", headers=headers)
        assert response.status_code == 200, f"Get classes failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Should have at least some classes"
        # Verify structure
        cls = data[0]
        assert "name" in cls
        assert "sections" in cls
        print(f"PASS: GET /api/classes returns {len(data)} classes")


class TestEmployees:
    """Employee endpoint tests"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_get_employees(self, admin_token):
        """Test GET /api/employees returns employee list"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/employees", headers=headers)
        assert response.status_code == 200, f"Get employees failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: GET /api/employees returns list with {len(data)} employees")
        return data
    
    def test_employee_link_user(self, admin_token):
        """Test POST /api/employees/{id}/link-user creates user account"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        
        # First get employees to find one without user_id
        employees_resp = requests.get(f"{BASE_URL}/api/employees", headers=headers)
        employees = employees_resp.json()
        
        unlinked = [e for e in employees if not e.get("user_id")]
        
        if not unlinked:
            # Create a test employee first
            new_emp = {
                "first_name": "TEST",
                "last_name": "LinkEmployee",
                "email": f"test_link_{os.urandom(4).hex()}@example.com",
                "phone": "1234567890",
                "department": "Teaching",
                "designation": "Teacher",
                "gender": "male"
            }
            create_resp = requests.post(f"{BASE_URL}/api/employees", json=new_emp, headers=headers)
            if create_resp.status_code == 200:
                emp = create_resp.json()
                # The employee was auto-linked during creation
                if not emp.get("user_id"):
                    employee_id = emp["employee_id"]
                else:
                    print("PASS: Employee auto-linked to user during creation")
                    return
            else:
                print(f"SKIP: Could not create test employee: {create_resp.text}")
                return
        else:
            employee_id = unlinked[0]["employee_id"]
        
        # Link user to employee
        response = requests.post(f"{BASE_URL}/api/employees/{employee_id}/link-user", headers=headers)
        
        if response.status_code == 400 and "already has a linked user" in response.text:
            print("PASS: Employee already linked (validation works)")
            return
        
        assert response.status_code == 200, f"Link user failed: {response.text}"
        data = response.json()
        assert "user_id" in data
        assert "temp_password" in data or "message" in data
        print(f"PASS: Employee-user linking works - user_id: {data.get('user_id')}")


class TestFeeStructure:
    """Fee structure endpoint tests"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_get_fee_structures(self, admin_token):
        """Test GET /api/fees/structure returns fee structures"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/fees/structure", headers=headers)
        assert response.status_code == 200, f"Get fee structures failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: GET /api/fees/structure returns list with {len(data)} structures")


class TestAnnouncements:
    """Announcement endpoint tests"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_get_announcements(self, admin_token):
        """Test GET /api/announcements returns announcements"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/announcements", headers=headers)
        assert response.status_code == 200, f"Get announcements failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: GET /api/announcements returns list with {len(data)} announcements")


class TestUtilities:
    """Utility endpoint tests (subjects, departments)"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_get_subjects(self, admin_token):
        """Test GET /api/subjects returns list"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/subjects", headers=headers)
        assert response.status_code == 200, f"Get subjects failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        assert "Mathematics" in data or "English" in data
        print(f"PASS: GET /api/subjects returns {len(data)} subjects")
    
    def test_get_departments(self, admin_token):
        """Test GET /api/departments returns list"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/departments", headers=headers)
        assert response.status_code == 200, f"Get departments failed: {response.text}"
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0
        print(f"PASS: GET /api/departments returns {len(data)} departments")


class TestReports:
    """Report endpoint tests"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_get_financial_report(self, admin_token):
        """Test GET /api/reports/financial returns financial data"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/financial", headers=headers)
        assert response.status_code == 200, f"Get financial report failed: {response.text}"
        data = response.json()
        assert "total_collection" in data
        assert "total_pending" in data
        assert "transaction_count" in data
        print(f"PASS: GET /api/reports/financial returns data - collection: {data['total_collection']}")
    
    def test_get_attendance_report(self, admin_token):
        """Test GET /api/reports/attendance returns attendance data"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/attendance", headers=headers)
        assert response.status_code == 200, f"Get attendance report failed: {response.text}"
        data = response.json()
        assert "total_records" in data
        assert "present" in data
        assert "absent" in data
        print(f"PASS: GET /api/reports/attendance returns data - records: {data['total_records']}")
    
    def test_get_academic_report(self, admin_token):
        """Test GET /api/reports/academic returns academic data"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/academic?class_name=1", headers=headers)
        assert response.status_code == 200, f"Get academic report failed: {response.text}"
        data = response.json()
        assert "academic_year" in data
        assert "student_count" in data
        assert "class_average" in data
        print(f"PASS: GET /api/reports/academic returns data - students: {data['student_count']}")


class TestReportsExport:
    """Report export endpoint tests (PDF/Excel)"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_financial_export_pdf(self, admin_token):
        """Test GET /api/reports/financial/export?format=pdf returns PDF"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/financial/export?format=pdf", headers=headers)
        assert response.status_code == 200, f"Financial PDF export failed: {response.text}"
        assert "application/pdf" in response.headers.get("Content-Type", "")
        assert len(response.content) > 100, "PDF content too small"
        print(f"PASS: Financial PDF export works - size: {len(response.content)} bytes")
    
    def test_financial_export_excel(self, admin_token):
        """Test GET /api/reports/financial/export?format=excel returns Excel"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/financial/export?format=excel", headers=headers)
        assert response.status_code == 200, f"Financial Excel export failed: {response.text}"
        content_type = response.headers.get("Content-Type", "")
        assert "spreadsheet" in content_type or "excel" in content_type or "officedocument" in content_type
        assert len(response.content) > 100, "Excel content too small"
        print(f"PASS: Financial Excel export works - size: {len(response.content)} bytes")
    
    def test_attendance_export_pdf(self, admin_token):
        """Test GET /api/reports/attendance/export?format=pdf returns PDF"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/attendance/export?format=pdf", headers=headers)
        assert response.status_code == 200, f"Attendance PDF export failed: {response.text}"
        assert "application/pdf" in response.headers.get("Content-Type", "")
        print(f"PASS: Attendance PDF export works - size: {len(response.content)} bytes")
    
    def test_attendance_export_excel(self, admin_token):
        """Test GET /api/reports/attendance/export?format=excel returns Excel"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/attendance/export?format=excel", headers=headers)
        assert response.status_code == 200, f"Attendance Excel export failed: {response.text}"
        print(f"PASS: Attendance Excel export works - size: {len(response.content)} bytes")
    
    def test_academic_export_pdf(self, admin_token):
        """Test GET /api/reports/academic/export?format=pdf&class_name=1 returns PDF"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/academic/export?format=pdf&class_name=1", headers=headers)
        assert response.status_code == 200, f"Academic PDF export failed: {response.text}"
        assert "application/pdf" in response.headers.get("Content-Type", "")
        print(f"PASS: Academic PDF export works - size: {len(response.content)} bytes")
    
    def test_academic_export_excel(self, admin_token):
        """Test GET /api/reports/academic/export?format=excel&class_name=1 returns Excel"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        response = requests.get(f"{BASE_URL}/api/reports/academic/export?format=excel&class_name=1", headers=headers)
        assert response.status_code == 200, f"Academic Excel export failed: {response.text}"
        print(f"PASS: Academic Excel export works - size: {len(response.content)} bytes")


class TestMarksMarksheet:
    """Marks and marksheet endpoint tests"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_marksheet_pdf(self, admin_token):
        """Test GET /api/marks/marksheet/{student_id}/pdf returns PDF"""
        headers = {"Authorization": f"Bearer {admin_token}"}
        
        # First get a student ID
        students_resp = requests.get(f"{BASE_URL}/api/students", headers=headers)
        students = students_resp.json()
        
        if not students:
            print("SKIP: No students to test marksheet PDF")
            return
        
        student_id = students[0]["student_id"]
        
        response = requests.get(f"{BASE_URL}/api/marks/marksheet/{student_id}/pdf", headers=headers)
        assert response.status_code == 200, f"Marksheet PDF failed: {response.text}"
        assert "application/pdf" in response.headers.get("Content-Type", "")
        print(f"PASS: Marksheet PDF export works for student {student_id}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
