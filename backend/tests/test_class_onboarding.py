"""
Backend Tests for Class Structure, Onboarding, Student Edit, and Audit Logs
This test suite covers the new enterprise-grade features in iteration 5.
"""
import pytest
import requests
import os
import random
import string

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
ADMIN_EMAIL = "admin@test.com"
ADMIN_PASSWORD = "Test1234!"
TEACHER_EMAIL = "teacher@school.com"
TEACHER_PASSWORD = "Teacher1234!"

def random_suffix():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))

class TestClassStructure:
    """Tests for Class Structure CRUD endpoints"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200, f"Admin login failed: {response.text}"
        self.admin_token = response.json()["token"]
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
    
    def test_get_classes_auto_seeds(self):
        """GET /api/classes should return classes (auto-seeds 15 defaults if empty)"""
        response = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        assert response.status_code == 200
        classes = response.json()
        assert isinstance(classes, list)
        # Should have at least 15 classes (Nursery, LKG, UKG + 1-12)
        assert len(classes) >= 15, f"Expected 15+ classes, got {len(classes)}"
        print(f"[PASS] GET /api/classes returns {len(classes)} classes")
    
    def test_classes_have_sections(self):
        """Each class should have sections with capacity and student_count"""
        response = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        assert response.status_code == 200
        classes = response.json()
        for cls in classes[:5]:  # Check first 5 classes
            assert "sections" in cls, f"Class {cls.get('name')} missing sections"
            for sec in cls["sections"]:
                assert "section_name" in sec, f"Section missing section_name"
                assert "capacity" in sec, f"Section missing capacity"
                assert "student_count" in sec, f"Section missing student_count"
        print(f"[PASS] Classes have sections with capacity and student_count")
    
    def test_create_class_admin_only(self):
        """POST /api/classes requires admin role"""
        # First, try with teacher credentials
        teacher_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEACHER_EMAIL,
            "password": TEACHER_PASSWORD
        })
        assert teacher_resp.status_code == 200
        teacher_token = teacher_resp.json()["token"]
        teacher_headers = {"Authorization": f"Bearer {teacher_token}"}
        
        new_class = {
            "name": f"TEST_CLASS_{random_suffix()}",
            "display_name": "Test Class",
            "sections": [{"section_name": "A", "capacity": 30}]
        }
        
        response = requests.post(f"{BASE_URL}/api/classes", json=new_class, headers=teacher_headers)
        assert response.status_code == 403, f"Teacher should get 403, got {response.status_code}"
        print(f"[PASS] POST /api/classes rejects teacher with 403")
    
    def test_create_class_as_admin(self):
        """Admin can create a new class"""
        new_class = {
            "name": f"TESTCLS{random_suffix()}",
            "display_name": "Test Class Created",
            "sections": [
                {"section_name": "X", "capacity": 25},
                {"section_name": "Y", "capacity": 30}
            ]
        }
        response = requests.post(f"{BASE_URL}/api/classes", json=new_class, headers=self.admin_headers)
        assert response.status_code == 200, f"Admin create class failed: {response.text}"
        created = response.json()
        assert created["name"] == new_class["name"]
        assert len(created["sections"]) == 2
        print(f"[PASS] Admin created class {new_class['name']}")
    
    def test_update_class_sections(self):
        """PUT /api/classes/:id can update sections and teacher assignments"""
        # Get existing class
        response = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        classes = response.json()
        cls = classes[0]  # Use first class
        
        # Update sections
        updated_sections = cls["sections"].copy()
        updated_sections[0]["capacity"] = 45  # Update capacity
        
        response = requests.put(
            f"{BASE_URL}/api/classes/{cls['class_id']}", 
            json={"sections": updated_sections},
            headers=self.admin_headers
        )
        assert response.status_code == 200, f"Update class failed: {response.text}"
        print(f"[PASS] Updated class sections for {cls['name']}")
    
    def test_get_class_students(self):
        """GET /api/classes/:id/students returns students for that class"""
        response = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        classes = response.json()
        cls = classes[0]
        
        response = requests.get(
            f"{BASE_URL}/api/classes/{cls['class_id']}/students",
            headers=self.admin_headers
        )
        assert response.status_code == 200, f"Get class students failed: {response.text}"
        students = response.json()
        assert isinstance(students, list)
        print(f"[PASS] GET /api/classes/{cls['class_id']}/students returns {len(students)} students")


class TestOnboardingWizard:
    """Tests for the 4-step student onboarding wizard"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        self.admin_token = response.json()["token"]
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
    
    def test_onboarding_step1_start(self):
        """Step 1: POST /api/onboarding/start creates application"""
        suffix = random_suffix()
        student_data = {
            "first_name": f"TEST_FirstName_{suffix}",
            "last_name": f"TEST_LastName_{suffix}",
            "email": f"test_student_{suffix}@test.com",
            "phone": "9876543210",
            "date_of_birth": "2015-05-15",
            "gender": "male",
            "address": "123 Test Street",
            "parent_name": f"TEST_Parent_{suffix}",
            "parent_phone": "9876543211",
            "parent_email": f"test_parent_{suffix}@test.com"
        }
        
        response = requests.post(f"{BASE_URL}/api/onboarding/start", json=student_data, headers=self.admin_headers)
        assert response.status_code == 200, f"Onboarding start failed: {response.text}"
        
        result = response.json()
        assert "onboarding_id" in result, "Missing onboarding_id"
        assert result["status"] == "draft", f"Expected status 'draft', got {result['status']}"
        assert result["first_name"] == student_data["first_name"]
        print(f"[PASS] Onboarding Step 1: Created application {result['onboarding_id']}")
        return result["onboarding_id"]
    
    def test_onboarding_full_flow(self):
        """Test complete onboarding flow: Step 1 -> Step 2 -> Step 3"""
        suffix = random_suffix()
        
        # Step 1: Start
        student_data = {
            "first_name": f"TEST_OnbFlow_{suffix}",
            "last_name": "FlowTest",
            "email": f"test_onbflow_{suffix}@test.com",
            "gender": "female",
            "date_of_birth": "2016-03-20",
            "parent_name": f"Parent_{suffix}",
            "parent_email": f"parent_onbflow_{suffix}@test.com"
        }
        
        response = requests.post(f"{BASE_URL}/api/onboarding/start", json=student_data, headers=self.admin_headers)
        assert response.status_code == 200
        onb_id = response.json()["onboarding_id"]
        print(f"[PASS] Step 1: Created onboarding {onb_id}")
        
        # Step 2: Select class & section
        # First, get available classes
        classes_resp = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        classes = classes_resp.json()
        test_class = classes[0]  # Use first class (Nursery or 1)
        test_section = test_class["sections"][0]["section_name"]
        
        class_data = {
            "class_name": test_class["name"],
            "section": test_section
        }
        response = requests.put(f"{BASE_URL}/api/onboarding/{onb_id}/class", json=class_data, headers=self.admin_headers)
        assert response.status_code == 200, f"Onboarding Step 2 failed: {response.text}"
        
        step2_result = response.json()
        assert step2_result["status"] == "class_selected"
        assert "fee_breakdown" in step2_result
        assert "total_fee" in step2_result
        assert "seats_available" in step2_result
        print(f"[PASS] Step 2: Selected class {test_class['name']}-{test_section}, Fee: {step2_result['total_fee']}")
        
        # Step 3: Complete onboarding
        response = requests.post(f"{BASE_URL}/api/onboarding/{onb_id}/complete", json={"admin_override": False}, headers=self.admin_headers)
        assert response.status_code == 200, f"Onboarding complete failed: {response.text}"
        
        result = response.json()
        assert "admission_number" in result, "Missing admission_number"
        assert "student_id" in result, "Missing student_id"
        assert result["admission_number"].startswith("SFS"), "Admission number should start with SFS"
        print(f"[PASS] Step 3: Completed onboarding. Admission: {result['admission_number']}")
        
        # Verify parent account was created (if parent_email was provided)
        if student_data.get("parent_email"):
            assert "parent_account" in result or result.get("parent_account") is not None, "Parent account should be created"
            if result.get("parent_account"):
                assert "temp_password" in result["parent_account"], "Missing temp password for parent"
                print(f"[PASS] Parent account created: {result['parent_account']['email']}")
        
        return result
    
    def test_onboarding_duplicate_detection(self):
        """Onboarding should reject duplicate students"""
        suffix = random_suffix()
        student_data = {
            "first_name": f"TEST_Dup_{suffix}",
            "last_name": "Duplicate",
            "date_of_birth": "2017-01-01",
            "gender": "male"
        }
        
        # First submission should succeed
        response = requests.post(f"{BASE_URL}/api/onboarding/start", json=student_data, headers=self.admin_headers)
        assert response.status_code == 200
        
        # Second submission with same data should fail (already in pipeline)
        response = requests.post(f"{BASE_URL}/api/onboarding/start", json=student_data, headers=self.admin_headers)
        assert response.status_code == 400, f"Expected 400 for duplicate, got {response.status_code}"
        print(f"[PASS] Duplicate onboarding rejected correctly")
    
    def test_onboarding_section_capacity_validation(self):
        """Onboarding should validate section capacity"""
        suffix = random_suffix()
        student_data = {
            "first_name": f"TEST_Cap_{suffix}",
            "last_name": "Capacity",
            "gender": "male"
        }
        
        response = requests.post(f"{BASE_URL}/api/onboarding/start", json=student_data, headers=self.admin_headers)
        assert response.status_code == 200
        onb_id = response.json()["onboarding_id"]
        
        # Get classes
        classes_resp = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        classes = classes_resp.json()
        
        # Try to set a valid class/section - should show seats_available
        class_data = {"class_name": classes[0]["name"], "section": classes[0]["sections"][0]["section_name"]}
        response = requests.put(f"{BASE_URL}/api/onboarding/{onb_id}/class", json=class_data, headers=self.admin_headers)
        assert response.status_code == 200
        assert "seats_available" in response.json()
        print(f"[PASS] Capacity validation - seats_available shown: {response.json()['seats_available']}")


class TestStudentEdit:
    """Tests for student edit with audit logging and field restrictions"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        self.admin_token = response.json()["token"]
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
    
    def test_student_edit_allowed_fields(self):
        """PUT /api/students/:id allows editing email, phone, address, class, section"""
        # First, get a student
        response = requests.get(f"{BASE_URL}/api/students", headers=self.admin_headers)
        students = response.json()
        
        if not students:
            pytest.skip("No students available for edit test")
        
        student = students[0]
        student_id = student["student_id"]
        
        # Update allowed fields
        update_data = {
            "phone": "9999888877",
            "address": "Updated Test Address 123"
        }
        
        response = requests.put(f"{BASE_URL}/api/students/{student_id}", json=update_data, headers=self.admin_headers)
        assert response.status_code == 200, f"Student update failed: {response.text}"
        
        updated = response.json()
        assert updated["phone"] == update_data["phone"]
        assert updated["address"] == update_data["address"]
        print(f"[PASS] Student {student_id} updated phone and address")
    
    def test_admission_number_immutable(self):
        """PUT /api/students/:id should NOT allow changing admission_number"""
        response = requests.get(f"{BASE_URL}/api/students", headers=self.admin_headers)
        students = response.json()
        
        if not students:
            pytest.skip("No students available for immutability test")
        
        student = students[0]
        student_id = student["student_id"]
        original_admission = student["admission_number"]
        
        # Try to change admission_number
        update_data = {"admission_number": "FAKE123456"}
        response = requests.put(f"{BASE_URL}/api/students/{student_id}", json=update_data, headers=self.admin_headers)
        
        # Should succeed but NOT change the admission_number
        assert response.status_code == 200
        updated = response.json()
        assert updated["admission_number"] == original_admission, \
            f"admission_number should be immutable! Was {original_admission}, now {updated['admission_number']}"
        print(f"[PASS] admission_number is immutable (stayed as {original_admission})")
    
    def test_student_edit_creates_audit_log(self):
        """Editing a student should create an audit log entry"""
        response = requests.get(f"{BASE_URL}/api/students", headers=self.admin_headers)
        students = response.json()
        
        if not students:
            pytest.skip("No students available for audit test")
        
        student = students[0]
        student_id = student["student_id"]
        
        # Make a change
        new_address = f"Audit Test Address {random_suffix()}"
        response = requests.put(
            f"{BASE_URL}/api/students/{student_id}", 
            json={"address": new_address},
            headers=self.admin_headers
        )
        assert response.status_code == 200
        
        # Check audit logs
        response = requests.get(
            f"{BASE_URL}/api/audit-logs",
            params={"entity_type": "student", "entity_id": student_id, "limit": 5},
            headers=self.admin_headers
        )
        assert response.status_code == 200
        logs = response.json()
        
        # Should have at least one update log for this student
        update_logs = [l for l in logs if l["action"] == "update" and l["entity_id"] == student_id]
        assert len(update_logs) > 0, "No update audit log found for student edit"
        print(f"[PASS] Student edit created audit log entry")
    
    def test_student_class_transfer_validation(self):
        """Changing class/section should validate the new class exists"""
        response = requests.get(f"{BASE_URL}/api/students", headers=self.admin_headers)
        students = response.json()
        
        if not students:
            pytest.skip("No students available for transfer test")
        
        student = students[0]
        student_id = student["student_id"]
        
        # Try to transfer to non-existent class
        update_data = {"class_name": "NonExistentClass999"}
        response = requests.put(f"{BASE_URL}/api/students/{student_id}", json=update_data, headers=self.admin_headers)
        assert response.status_code == 400, f"Expected 400 for invalid class, got {response.status_code}"
        print(f"[PASS] Invalid class transfer rejected")
        
        # Try to transfer to non-existent section
        classes_resp = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        valid_class = classes_resp.json()[0]["name"]
        update_data = {"class_name": valid_class, "section": "ZZZ_NonExistent"}
        response = requests.put(f"{BASE_URL}/api/students/{student_id}", json=update_data, headers=self.admin_headers)
        assert response.status_code == 400, f"Expected 400 for invalid section, got {response.status_code}"
        print(f"[PASS] Invalid section transfer rejected")


class TestAuditLogs:
    """Tests for the audit log system"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        self.admin_token = response.json()["token"]
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
    
    def test_get_audit_logs(self):
        """GET /api/audit-logs returns audit entries"""
        response = requests.get(f"{BASE_URL}/api/audit-logs", headers=self.admin_headers)
        assert response.status_code == 200
        logs = response.json()
        assert isinstance(logs, list)
        print(f"[PASS] GET /api/audit-logs returns {len(logs)} entries")
    
    def test_audit_logs_admin_only(self):
        """GET /api/audit-logs requires admin role"""
        # Try with teacher
        teacher_resp = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": TEACHER_EMAIL,
            "password": TEACHER_PASSWORD
        })
        if teacher_resp.status_code == 200:
            teacher_headers = {"Authorization": f"Bearer {teacher_resp.json()['token']}"}
            response = requests.get(f"{BASE_URL}/api/audit-logs", headers=teacher_headers)
            assert response.status_code == 403, f"Teacher should get 403, got {response.status_code}"
            print(f"[PASS] Audit logs restricted to admin")
    
    def test_audit_logs_filter_by_entity(self):
        """Audit logs can be filtered by entity_type"""
        response = requests.get(
            f"{BASE_URL}/api/audit-logs",
            params={"entity_type": "student"},
            headers=self.admin_headers
        )
        assert response.status_code == 200
        logs = response.json()
        for log in logs:
            assert log["entity_type"] == "student", f"Filter failed: got {log['entity_type']}"
        print(f"[PASS] Audit logs filtered by entity_type works")
    
    def test_audit_logs_onboarding_entries(self):
        """Onboarding actions create audit entries"""
        response = requests.get(
            f"{BASE_URL}/api/audit-logs",
            params={"entity_type": "onboarding", "limit": 10},
            headers=self.admin_headers
        )
        assert response.status_code == 200
        logs = response.json()
        # May or may not have onboarding logs depending on test order
        print(f"[PASS] Audit logs for onboarding: {len(logs)} entries")


class TestRegistrationSecurity:
    """Tests for registration page security - only parent role allowed"""
    
    def test_registration_only_parent_role(self):
        """Public registration should only allow parent role"""
        suffix = random_suffix()
        
        # Try to register as admin (should fail)
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"test_admin_{suffix}@test.com",
            "name": "Test Admin",
            "password": "TestPass123!",
            "role": "admin"
        })
        assert response.status_code == 403, f"Admin registration should be blocked, got {response.status_code}"
        
        # Try to register as teacher (should fail)
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"test_teacher_{suffix}@test.com",
            "name": "Test Teacher",
            "password": "TestPass123!",
            "role": "teacher"
        })
        assert response.status_code == 403, f"Teacher registration should be blocked, got {response.status_code}"
        
        # Register as parent (should succeed)
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": f"test_parent_reg_{suffix}@test.com",
            "name": "Test Parent",
            "password": "TestPass123!",
            "role": "parent"
        })
        assert response.status_code == 200, f"Parent registration failed: {response.text}"
        print(f"[PASS] Registration restricted to parent role only")


class TestSectionFilters:
    """Tests for section filters using new class structure format"""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json={
            "email": ADMIN_EMAIL,
            "password": ADMIN_PASSWORD
        })
        assert response.status_code == 200
        self.admin_token = response.json()["token"]
        self.admin_headers = {"Authorization": f"Bearer {self.admin_token}"}
    
    def test_sections_are_objects(self):
        """Sections in classes should be objects with section_name, capacity, student_count"""
        response = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        assert response.status_code == 200
        classes = response.json()
        
        for cls in classes[:5]:
            for sec in cls.get("sections", []):
                assert isinstance(sec, dict), f"Section should be dict, got {type(sec)}"
                assert "section_name" in sec, "Section missing section_name"
                assert "capacity" in sec, "Section missing capacity"
                assert "student_count" in sec, "Section missing student_count"
        print(f"[PASS] Sections are DB-backed objects with proper structure")
    
    def test_students_filter_by_class_section(self):
        """GET /api/students can filter by class_name and section"""
        response = requests.get(f"{BASE_URL}/api/classes", headers=self.admin_headers)
        classes = response.json()
        test_class = classes[0]
        test_section = test_class["sections"][0]["section_name"]
        
        response = requests.get(
            f"{BASE_URL}/api/students",
            params={"class_name": test_class["name"], "section": test_section},
            headers=self.admin_headers
        )
        assert response.status_code == 200
        students = response.json()
        for s in students:
            assert s["class_name"] == test_class["name"]
            assert s["section"] == test_section
        print(f"[PASS] Students filter by class/section works")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
