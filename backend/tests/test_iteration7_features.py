"""
Iteration 7 Backend Tests - Testing Attendance, Marks, Reports, Fees, and RBAC
Tests for:
- Admin login and dashboard
- Attendance: mark, submit, lock, unlock
- Marks: exam CRUD, marks entry, lock/unlock, publish
- Reports: financial, attendance, academic
- Fees: class config
- RBAC: teacher access restrictions
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://shemford-mobile.preview.emergentagent.com')

class TestAuthAndDashboard:
    """Test authentication and dashboard endpoints"""
    
    def test_health_check(self):
        """Health endpoint should return healthy status"""
        response = requests.get(f"{BASE_URL}/api/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        print("PASS: Health check working")
    
    def test_admin_login(self):
        """Admin login should work with correct credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "admin"
        print(f"PASS: Admin login successful, role={data['user']['role']}")
        return data["token"]
    
    def test_teacher_login(self):
        """Teacher login should work with correct credentials"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "teacher@school.com",
            "password": "Teacher1234!"
        })
        assert response.status_code == 200
        data = response.json()
        assert "token" in data
        assert data["user"]["role"] == "teacher"
        print(f"PASS: Teacher login successful, role={data['user']['role']}")
        return data["token"]
    
    def test_admin_dashboard(self):
        """Admin dashboard should return stats"""
        # Login first
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        token = login_resp.json()["token"]
        
        # Get dashboard
        response = requests.get(
            f"{BASE_URL}/api/reports/dashboard",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_students" in data
        assert "total_employees" in data
        print(f"PASS: Admin dashboard - students={data.get('total_students')}, employees={data.get('total_employees')}")


class TestAttendance:
    """Test attendance marking, locking, and unlocking"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    @pytest.fixture
    def teacher_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "teacher@school.com",
            "password": "Teacher1234!"
        })
        return response.json()["token"]
    
    def test_get_classes(self, admin_token):
        """Get classes for attendance selection"""
        response = requests.get(
            f"{BASE_URL}/api/classes",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: Got {len(data)} classes")
        return data
    
    def test_get_students_by_class(self, admin_token):
        """Get students for a specific class/section"""
        # First get classes
        classes_resp = requests.get(
            f"{BASE_URL}/api/classes",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        classes = classes_resp.json()
        
        if classes:
            class_name = classes[0]["name"]
            sections = classes[0].get("sections", [])
            section = sections[0]["section_name"] if sections and isinstance(sections[0], dict) else (sections[0] if sections else "A")
            
            response = requests.get(
                f"{BASE_URL}/api/students",
                params={"class_name": class_name, "section": section},
                headers={"Authorization": f"Bearer {admin_token}"}
            )
            assert response.status_code == 200
            data = response.json()
            print(f"PASS: Got {len(data)} students for {class_name}-{section}")
            return data
        print("SKIP: No classes found")
        return []
    
    def test_submit_attendance(self, admin_token):
        """Submit attendance for a class/section"""
        # Get classes and students
        classes_resp = requests.get(
            f"{BASE_URL}/api/classes",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        classes = classes_resp.json()
        
        if not classes:
            pytest.skip("No classes found")
        
        class_name = classes[0]["name"]
        sections = classes[0].get("sections", [])
        section = sections[0]["section_name"] if sections and isinstance(sections[0], dict) else (sections[0] if sections else "A")
        
        students_resp = requests.get(
            f"{BASE_URL}/api/students",
            params={"class_name": class_name, "section": section},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        students = students_resp.json()
        
        if not students:
            pytest.skip("No students found")
        
        # Create attendance records
        records = []
        for i, student in enumerate(students[:5]):  # Test with first 5 students
            status = "present" if i % 2 == 0 else "absent"
            records.append({
                "entity_id": student["student_id"],
                "status": status
            })
        
        response = requests.post(
            f"{BASE_URL}/api/attendance",
            json={
                "class_name": class_name,
                "section": section,
                "date": "2026-03-21",
                "records": records
            },
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "success" in data
        assert data.get("is_locked") == True
        print(f"PASS: Attendance submitted - success={data['success']}, locked={data.get('is_locked')}")
        return {"class_name": class_name, "section": section, "date": "2026-03-21"}
    
    def test_get_session_status(self, admin_token):
        """Check attendance session status (locked/unlocked)"""
        # First submit attendance
        classes_resp = requests.get(
            f"{BASE_URL}/api/classes",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        classes = classes_resp.json()
        
        if not classes:
            pytest.skip("No classes found")
        
        class_name = classes[0]["name"]
        sections = classes[0].get("sections", [])
        section = sections[0]["section_name"] if sections and isinstance(sections[0], dict) else (sections[0] if sections else "A")
        
        response = requests.get(
            f"{BASE_URL}/api/attendance/session-status",
            params={"class_name": class_name, "section": section, "date": "2026-03-21"},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        print(f"PASS: Session status - submitted={data.get('submitted')}, locked={data.get('is_locked')}")
    
    def test_unlock_attendance_admin(self, admin_token):
        """Admin should be able to unlock attendance"""
        classes_resp = requests.get(
            f"{BASE_URL}/api/classes",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        classes = classes_resp.json()
        
        if not classes:
            pytest.skip("No classes found")
        
        class_name = classes[0]["name"]
        sections = classes[0].get("sections", [])
        section = sections[0]["section_name"] if sections and isinstance(sections[0], dict) else (sections[0] if sections else "A")
        
        response = requests.post(
            f"{BASE_URL}/api/attendance/unlock",
            json={
                "class_name": class_name,
                "section": section,
                "date": "2026-03-21"
            },
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        # May return 200 or 404 if no session exists
        assert response.status_code in [200, 404]
        if response.status_code == 200:
            print(f"PASS: Attendance unlocked successfully")
        else:
            print(f"INFO: No attendance session to unlock")


class TestMarks:
    """Test exam CRUD, marks entry, lock/unlock, publish"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    @pytest.fixture
    def teacher_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "teacher@school.com",
            "password": "Teacher1234!"
        })
        return response.json()["token"]
    
    def test_get_exams(self, admin_token):
        """Get list of exams"""
        response = requests.get(
            f"{BASE_URL}/api/exams",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: Got {len(data)} exams")
        for exam in data[:3]:
            print(f"  - {exam.get('name')} ({exam.get('class_name')}) locked={exam.get('is_locked')} published={exam.get('is_published')}")
        return data
    
    def test_create_exam(self, admin_token):
        """Admin creates a new exam"""
        # Get classes first
        classes_resp = requests.get(
            f"{BASE_URL}/api/classes",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        classes = classes_resp.json()
        
        if not classes:
            pytest.skip("No classes found")
        
        class_name = classes[0]["name"]
        
        # Get subjects
        subjects_resp = requests.get(
            f"{BASE_URL}/api/subjects",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        subjects = subjects_resp.json()
        
        exam_subjects = []
        for subj in subjects[:3]:  # Use first 3 subjects
            exam_subjects.append({"subject": subj, "max_marks": 100})
        
        if not exam_subjects:
            exam_subjects = [{"subject": "Mathematics", "max_marks": 100}]
        
        response = requests.post(
            f"{BASE_URL}/api/exams",
            json={
                "name": "Test Exam March 2026",
                "exam_type": "unit_test",
                "class_name": class_name,
                "academic_year": "2025-2026",
                "subjects": exam_subjects
            },
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "exam_id" in data
        print(f"PASS: Exam created - {data.get('name')} (ID: {data.get('exam_id')})")
        return data
    
    def test_get_marks(self, admin_token):
        """Get marks for an exam"""
        # Get exams first
        exams_resp = requests.get(
            f"{BASE_URL}/api/exams",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        exams = exams_resp.json()
        
        if not exams:
            pytest.skip("No exams found")
        
        exam = exams[0]
        
        response = requests.get(
            f"{BASE_URL}/api/marks",
            params={"exam_id": exam["exam_id"]},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        print(f"PASS: Got {len(data)} marks records for exam {exam.get('name')}")
    
    def test_lock_exam(self, admin_token):
        """Admin locks an exam"""
        # Get exams
        exams_resp = requests.get(
            f"{BASE_URL}/api/exams",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        exams = exams_resp.json()
        
        # Find an unlocked exam
        unlocked_exam = None
        for exam in exams:
            if not exam.get("is_locked"):
                unlocked_exam = exam
                break
        
        if not unlocked_exam:
            print("INFO: No unlocked exams to lock")
            return
        
        response = requests.post(
            f"{BASE_URL}/api/exams/{unlocked_exam['exam_id']}/lock",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        print(f"PASS: Exam '{unlocked_exam.get('name')}' locked")
    
    def test_unlock_exam(self, admin_token):
        """Admin unlocks an exam"""
        # Get exams
        exams_resp = requests.get(
            f"{BASE_URL}/api/exams",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        exams = exams_resp.json()
        
        # Find a locked exam
        locked_exam = None
        for exam in exams:
            if exam.get("is_locked"):
                locked_exam = exam
                break
        
        if not locked_exam:
            print("INFO: No locked exams to unlock")
            return
        
        response = requests.post(
            f"{BASE_URL}/api/exams/{locked_exam['exam_id']}/unlock",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        print(f"PASS: Exam '{locked_exam.get('name')}' unlocked")
    
    def test_publish_exam(self, admin_token):
        """Admin publishes an exam"""
        # Get exams
        exams_resp = requests.get(
            f"{BASE_URL}/api/exams",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        exams = exams_resp.json()
        
        # Find an unpublished exam
        unpublished_exam = None
        for exam in exams:
            if not exam.get("is_published"):
                unpublished_exam = exam
                break
        
        if not unpublished_exam:
            print("INFO: No unpublished exams to publish")
            return
        
        response = requests.post(
            f"{BASE_URL}/api/exams/{unpublished_exam['exam_id']}/publish",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        print(f"PASS: Exam '{unpublished_exam.get('name')}' published")


class TestReports:
    """Test financial, attendance, and academic reports"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_financial_report(self, admin_token):
        """Get financial report"""
        response = requests.get(
            f"{BASE_URL}/api/reports/financial",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_collection" in data
        assert "total_pending" in data
        assert "transaction_count" in data
        print(f"PASS: Financial report - collection={data.get('total_collection')}, pending={data.get('total_pending')}, transactions={data.get('transaction_count')}")
    
    def test_attendance_report(self, admin_token):
        """Get attendance report"""
        response = requests.get(
            f"{BASE_URL}/api/reports/attendance",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "total_records" in data
        assert "present" in data
        assert "absent" in data
        assert "percentage" in data
        print(f"PASS: Attendance report - total={data.get('total_records')}, present={data.get('present')}, absent={data.get('absent')}, pct={data.get('percentage')}%")
    
    def test_academic_report(self, admin_token):
        """Get academic report"""
        # Get classes first
        classes_resp = requests.get(
            f"{BASE_URL}/api/classes",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        classes = classes_resp.json()
        
        if not classes:
            pytest.skip("No classes found")
        
        class_name = classes[0]["name"]
        
        response = requests.get(
            f"{BASE_URL}/api/reports/academic",
            params={"class_name": class_name},
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert "student_count" in data
        assert "class_average" in data
        print(f"PASS: Academic report for {class_name} - students={data.get('student_count')}, avg={data.get('class_average')}")


class TestFees:
    """Test fee configuration and management"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    def test_get_class_fee_config(self, admin_token):
        """Get fee configuration for all classes"""
        response = requests.get(
            f"{BASE_URL}/api/fees/class-config",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        print(f"PASS: Got fee config for {len(data)} classes")
        for cls in data[:3]:
            print(f"  - {cls.get('display_name')}: annual={cls.get('annual_fee')}, monthly={cls.get('monthly_amount')}, students={cls.get('student_count')}")
    
    def test_get_fee_structure(self, admin_token):
        """Get fee structures (legacy endpoint)"""
        response = requests.get(
            f"{BASE_URL}/api/fees/structure",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        print(f"PASS: Got {len(data)} fee structures")
    
    def test_get_due_chart(self, admin_token):
        """Get due chart showing students with pending fees"""
        response = requests.get(
            f"{BASE_URL}/api/fees/due-chart",
            headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert response.status_code == 200
        data = response.json()
        print(f"PASS: Due chart has {len(data)} students with pending fees")


class TestRBAC:
    """Test role-based access control"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "admin@test.com",
            "password": "Test1234!"
        })
        return response.json()["token"]
    
    @pytest.fixture
    def teacher_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": "teacher@school.com",
            "password": "Teacher1234!"
        })
        return response.json()["token"]
    
    def test_teacher_can_access_attendance(self, teacher_token):
        """Teacher should be able to access attendance"""
        response = requests.get(
            f"{BASE_URL}/api/attendance",
            headers={"Authorization": f"Bearer {teacher_token}"}
        )
        assert response.status_code == 200
        print("PASS: Teacher can access attendance")
    
    def test_teacher_can_access_marks(self, teacher_token):
        """Teacher should be able to access marks"""
        response = requests.get(
            f"{BASE_URL}/api/marks",
            headers={"Authorization": f"Bearer {teacher_token}"}
        )
        assert response.status_code == 200
        print("PASS: Teacher can access marks")
    
    def test_teacher_cannot_access_fees(self, teacher_token):
        """Teacher should NOT be able to access fee config"""
        response = requests.get(
            f"{BASE_URL}/api/fees/class-config",
            headers={"Authorization": f"Bearer {teacher_token}"}
        )
        assert response.status_code == 403
        print("PASS: Teacher correctly denied access to fee config")
    
    def test_teacher_cannot_access_financial_reports(self, teacher_token):
        """Teacher should NOT be able to access financial reports"""
        response = requests.get(
            f"{BASE_URL}/api/reports/financial",
            headers={"Authorization": f"Bearer {teacher_token}"}
        )
        assert response.status_code == 403
        print("PASS: Teacher correctly denied access to financial reports")
    
    def test_teacher_can_access_attendance_reports(self, teacher_token):
        """Teacher should be able to access attendance reports"""
        response = requests.get(
            f"{BASE_URL}/api/reports/attendance",
            headers={"Authorization": f"Bearer {teacher_token}"}
        )
        assert response.status_code == 200
        print("PASS: Teacher can access attendance reports")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
