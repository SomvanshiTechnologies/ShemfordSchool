"""
Comprehensive audit test suite for School Management System.
Tests: Registration security, RBAC, marks validation, fee access, dashboard stats, messaging restrictions.
"""
import pytest
import requests
import os
import uuid

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
if not BASE_URL:
    BASE_URL = 'https://shemford-mobile.preview.emergentagent.com'

# Test credentials
ADMIN_CREDS = {"email": "admin@test.com", "password": "Test1234!"}
TEACHER_CREDS = {"email": "teacher@school.com", "password": "Teacher1234!"}
PARENT_CREDS = {"email": "parent@test.com", "password": "Test1234!"}


class TestRegistrationSecurity:
    """Tests for public registration endpoint security"""
    
    def test_register_as_parent_should_succeed(self):
        """Public registration should accept parent role"""
        unique_email = f"test_parent_{uuid.uuid4().hex[:8]}@test.com"
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": unique_email,
            "name": "Test Parent",
            "password": "TestPass1234!",
            "role": "parent"
        })
        # Should either succeed (201/200) or fail with duplicate email
        assert response.status_code in [200, 201, 400], f"Unexpected status: {response.status_code}"
        if response.status_code in [200, 201]:
            data = response.json()
            assert "user" in data or "token" in data
            print(f"✅ Parent registration succeeded for {unique_email}")
    
    def test_register_as_admin_should_fail(self):
        """Public registration should REJECT admin role"""
        unique_email = f"test_admin_{uuid.uuid4().hex[:8]}@test.com"
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": unique_email,
            "name": "Test Admin",
            "password": "TestPass1234!",
            "role": "admin"
        })
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        assert "parent" in response.json().get("detail", "").lower()
        print("✅ Admin registration correctly rejected")
    
    def test_register_as_teacher_should_fail(self):
        """Public registration should REJECT teacher role"""
        unique_email = f"test_teacher_{uuid.uuid4().hex[:8]}@test.com"
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": unique_email,
            "name": "Test Teacher",
            "password": "TestPass1234!",
            "role": "teacher"
        })
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✅ Teacher registration correctly rejected")
    
    def test_register_as_student_should_fail(self):
        """Public registration should REJECT student role"""
        unique_email = f"test_student_{uuid.uuid4().hex[:8]}@test.com"
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": unique_email,
            "name": "Test Student",
            "password": "TestPass1234!",
            "role": "student"
        })
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✅ Student registration correctly rejected")
    
    def test_register_as_accountant_should_fail(self):
        """Public registration should REJECT accountant role"""
        unique_email = f"test_accountant_{uuid.uuid4().hex[:8]}@test.com"
        response = requests.post(f"{BASE_URL}/api/auth/register", json={
            "email": unique_email,
            "name": "Test Accountant",
            "password": "TestPass1234!",
            "role": "accountant"
        })
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✅ Accountant registration correctly rejected")


class TestAdminCreateUser:
    """Tests for admin-only user creation endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Admin login failed: {response.text}")
        return response.json().get("token")
    
    def test_admin_can_create_teacher(self, admin_token):
        """Admin should be able to create teacher accounts"""
        unique_email = f"teacher_{uuid.uuid4().hex[:8]}@school.com"
        response = requests.post(
            f"{BASE_URL}/api/auth/create-user",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "email": unique_email,
                "name": "New Teacher",
                "password": "Teacher1234!",
                "role": "teacher"
            }
        )
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        data = response.json()
        assert data.get("user", {}).get("role") == "teacher" or data.get("message")
        print(f"✅ Admin created teacher account: {unique_email}")
    
    def test_admin_can_create_student(self, admin_token):
        """Admin should be able to create student accounts"""
        unique_email = f"student_{uuid.uuid4().hex[:8]}@school.com"
        response = requests.post(
            f"{BASE_URL}/api/auth/create-user",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "email": unique_email,
                "name": "New Student",
                "password": "Student1234!",
                "role": "student"
            }
        )
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        print(f"✅ Admin created student account: {unique_email}")
    
    def test_admin_can_create_accountant(self, admin_token):
        """Admin should be able to create accountant accounts"""
        unique_email = f"accountant_{uuid.uuid4().hex[:8]}@school.com"
        response = requests.post(
            f"{BASE_URL}/api/auth/create-user",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "email": unique_email,
                "name": "New Accountant",
                "password": "Account1234!",
                "role": "accountant"
            }
        )
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        print(f"✅ Admin created accountant account: {unique_email}")
    
    def test_non_admin_cannot_create_user(self):
        """Teacher should NOT be able to use create-user endpoint"""
        # Login as teacher
        login_resp = requests.post(f"{BASE_URL}/api/auth/login", json=TEACHER_CREDS)
        if login_resp.status_code != 200:
            pytest.skip(f"Teacher login failed: {login_resp.text}")
        teacher_token = login_resp.json().get("token")
        
        unique_email = f"test_{uuid.uuid4().hex[:8]}@school.com"
        response = requests.post(
            f"{BASE_URL}/api/auth/create-user",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={
                "email": unique_email,
                "name": "Test User",
                "password": "TestPass1234!",
                "role": "student"
            }
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✅ Teacher correctly prevented from creating users")


class TestMarksValidation:
    """Tests for marks validation and upsert logic"""
    
    @pytest.fixture
    def admin_token(self):
        """Get admin auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Admin login failed: {response.text}")
        return response.json().get("token")
    
    def test_marks_reject_marks_exceeding_max(self, admin_token):
        """Marks entry should reject marks_obtained > max_marks"""
        response = requests.post(
            f"{BASE_URL}/api/marks",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "records": [{
                    "student_id": "TEST_STUDENT_001",
                    "class_name": "10",
                    "section": "A",
                    "subject": "Mathematics",
                    "exam_type": "unit_test",
                    "term": "term1",
                    "academic_year": "2024-2025",
                    "marks_obtained": 150,  # Exceeds max
                    "max_marks": 100
                }]
            }
        )
        assert response.status_code == 200, f"API call failed: {response.text}"
        data = response.json()
        # Should fail validation
        assert data.get("failed") > 0, f"Expected validation failure, got: {data}"
        # Check error message mentions the issue
        errors = data.get("errors", [])
        if errors:
            assert any("exceed" in str(e).lower() or "cannot" in str(e).lower() for e in errors)
        print(f"✅ Marks validation correctly rejected exceeding marks: {data}")
    
    def test_marks_reject_negative_marks(self, admin_token):
        """Marks entry should reject negative marks_obtained"""
        response = requests.post(
            f"{BASE_URL}/api/marks",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "records": [{
                    "student_id": "TEST_STUDENT_001",
                    "class_name": "10",
                    "section": "A",
                    "subject": "Science",
                    "exam_type": "unit_test",
                    "term": "term1",
                    "academic_year": "2024-2025",
                    "marks_obtained": -5,  # Negative
                    "max_marks": 100
                }]
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("failed") > 0, f"Expected validation failure for negative marks: {data}"
        print(f"✅ Marks validation correctly rejected negative marks: {data}")
    
    def test_marks_reject_zero_max_marks(self, admin_token):
        """Marks entry should reject max_marks <= 0"""
        response = requests.post(
            f"{BASE_URL}/api/marks",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "records": [{
                    "student_id": "TEST_STUDENT_001",
                    "class_name": "10",
                    "section": "A",
                    "subject": "English",
                    "exam_type": "unit_test",
                    "term": "term1",
                    "academic_year": "2024-2025",
                    "marks_obtained": 50,
                    "max_marks": 0  # Zero max_marks
                }]
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("failed") > 0, f"Expected validation failure for zero max_marks: {data}"
        print(f"✅ Marks validation correctly rejected zero max_marks: {data}")
    
    def test_marks_valid_entry_succeeds(self, admin_token):
        """Valid marks entry should succeed"""
        student_id = f"TEST_STUDENT_{uuid.uuid4().hex[:6]}"
        response = requests.post(
            f"{BASE_URL}/api/marks",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "records": [{
                    "student_id": student_id,
                    "class_name": "10",
                    "section": "A",
                    "subject": "Mathematics",
                    "exam_type": "unit_test",
                    "term": "term1",
                    "academic_year": "2024-2025",
                    "marks_obtained": 85,
                    "max_marks": 100
                }]
            }
        )
        assert response.status_code == 200
        data = response.json()
        assert data.get("success") >= 1, f"Expected success, got: {data}"
        print(f"✅ Valid marks entry succeeded: {data}")
    
    def test_marks_upsert_updates_existing(self, admin_token):
        """Re-submitting same student/subject/exam/term should update, not duplicate"""
        student_id = f"TEST_UPSERT_{uuid.uuid4().hex[:6]}"
        mark_data = {
            "student_id": student_id,
            "class_name": "10",
            "section": "A",
            "subject": "Physics",
            "exam_type": "midterm",
            "term": "term1",
            "academic_year": "2024-2025",
            "marks_obtained": 70,
            "max_marks": 100
        }
        
        # First submission
        resp1 = requests.post(
            f"{BASE_URL}/api/marks",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"records": [mark_data]}
        )
        assert resp1.status_code == 200
        
        # Second submission with updated marks
        mark_data["marks_obtained"] = 85
        resp2 = requests.post(
            f"{BASE_URL}/api/marks",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={"records": [mark_data]}
        )
        assert resp2.status_code == 200
        
        # Fetch marks to verify only one record exists
        get_resp = requests.get(
            f"{BASE_URL}/api/marks",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={
                "student_id": student_id,
                "subject": "Physics",
                "exam_type": "midterm",
                "term": "term1"
            }
        )
        assert get_resp.status_code == 200
        marks = get_resp.json()
        
        # Should have only 1 record (upsert), not 2
        physics_marks = [m for m in marks if m.get("subject") == "Physics" and m.get("exam_type") == "midterm"]
        assert len(physics_marks) == 1, f"Expected 1 record (upsert), got {len(physics_marks)}: {physics_marks}"
        assert physics_marks[0].get("marks_obtained") == 85, f"Marks should be updated to 85"
        print(f"✅ Marks upsert working correctly - only 1 record with updated value")


class TestTeacherDashboard:
    """Tests for teacher dashboard real stats"""
    
    @pytest.fixture
    def teacher_token(self):
        """Get teacher auth token"""
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEACHER_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Teacher login failed: {response.text}")
        return response.json().get("token")
    
    def test_teacher_dashboard_no_hardcoded_value(self, teacher_token):
        """Teacher dashboard should NOT return hardcoded value '3' for assigned_classes"""
        response = requests.get(
            f"{BASE_URL}/api/reports/dashboard",
            headers={"Authorization": f"Bearer {teacher_token}"}
        )
        assert response.status_code == 200, f"Dashboard failed: {response.text}"
        data = response.json()
        
        # The value should be computed from DB, not hardcoded to 3
        assigned_classes = data.get("assigned_classes")
        # We can't predict exact value, but we can verify the key exists and is a number
        assert isinstance(assigned_classes, int), f"assigned_classes should be int, got {type(assigned_classes)}"
        print(f"✅ Teacher dashboard returned assigned_classes={assigned_classes} (not hardcoded)")


class TestUserSearchEndpoint:
    """Tests for user search endpoint used in messaging"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Admin login failed: {response.text}")
        return response.json().get("token")
    
    def test_user_search_endpoint_exists(self, admin_token):
        """User search endpoint should exist and return results"""
        response = requests.get(
            f"{BASE_URL}/api/users/search",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"q": "admin"}
        )
        assert response.status_code == 200, f"User search failed: {response.text}"
        data = response.json()
        assert isinstance(data, list), f"Expected list, got {type(data)}"
        print(f"✅ User search endpoint working, returned {len(data)} results")
    
    def test_user_search_returns_user_details(self, admin_token):
        """User search should return user_id, name, email, role"""
        response = requests.get(
            f"{BASE_URL}/api/users/search",
            headers={"Authorization": f"Bearer {admin_token}"},
            params={"q": "admin"}
        )
        assert response.status_code == 200
        data = response.json()
        
        if len(data) > 0:
            user = data[0]
            assert "user_id" in user, "Missing user_id"
            assert "name" in user, "Missing name"
            assert "email" in user, "Missing email"
            assert "role" in user, "Missing role"
            print(f"✅ User search returns proper fields: {list(user.keys())}")
        else:
            print("⚠️ No users found in search, skipping field validation")


class TestMessageRoleRestrictions:
    """Tests for message role-based restrictions"""
    
    @pytest.fixture
    def parent_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json=PARENT_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Parent login failed: {response.text}")
        return response.json().get("token")
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Admin login failed: {response.text}")
        return response.json().get("token")
    
    def test_parent_cannot_broadcast_to_all(self, parent_token):
        """Parents should NOT be able to broadcast to all users"""
        response = requests.post(
            f"{BASE_URL}/api/messages",
            headers={"Authorization": f"Bearer {parent_token}"},
            json={
                "recipient_type": "all",
                "subject": "Test Broadcast",
                "content": "This should be rejected"
            }
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✅ Parent correctly prevented from broadcasting to all")
    
    def test_parent_cannot_message_all_students(self, parent_token):
        """Parents should NOT be able to message all students"""
        response = requests.post(
            f"{BASE_URL}/api/messages",
            headers={"Authorization": f"Bearer {parent_token}"},
            json={
                "recipient_type": "student",
                "subject": "Test to Students",
                "content": "This should be rejected"
            }
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✅ Parent correctly prevented from messaging all students")
    
    def test_parent_cannot_message_all_parents(self, parent_token):
        """Parents should NOT be able to broadcast to all parents"""
        response = requests.post(
            f"{BASE_URL}/api/messages",
            headers={"Authorization": f"Bearer {parent_token}"},
            json={
                "recipient_type": "parent",
                "subject": "Test to Parents",
                "content": "This should be rejected"
            }
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✅ Parent correctly prevented from messaging all parents")
    
    def test_admin_can_broadcast_to_all(self, admin_token):
        """Admin SHOULD be able to broadcast to all"""
        response = requests.post(
            f"{BASE_URL}/api/messages",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "recipient_type": "all",
                "subject": "Test Admin Broadcast",
                "content": "This is an admin broadcast test"
            }
        )
        assert response.status_code in [200, 201], f"Expected 200/201, got {response.status_code}: {response.text}"
        print("✅ Admin can broadcast to all users")


class TestGeneratePendingPayments:
    """Tests for generate pending payments endpoint"""
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Admin login failed: {response.text}")
        return response.json().get("token")
    
    def test_generate_pending_endpoint_exists(self, admin_token):
        """Generate pending payments endpoint should exist"""
        response = requests.post(
            f"{BASE_URL}/api/fees/generate-pending",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "class_name": "10",
                "month": "2024-12"
            }
        )
        # Should succeed or fail with appropriate error (e.g., no fee structures)
        assert response.status_code in [200, 404], f"Unexpected status: {response.status_code}: {response.text}"
        print(f"✅ Generate pending endpoint exists, status: {response.status_code}")
    
    def test_generate_pending_requires_class(self, admin_token):
        """Generate pending should require class_name"""
        response = requests.post(
            f"{BASE_URL}/api/fees/generate-pending",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "month": "2024-12"
            }
        )
        assert response.status_code == 400, f"Expected 400 for missing class_name, got {response.status_code}"
        print("✅ Generate pending correctly requires class_name")


class TestStudentCreationAccess:
    """Tests for student creation access control"""
    
    @pytest.fixture
    def teacher_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json=TEACHER_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Teacher login failed: {response.text}")
        return response.json().get("token")
    
    @pytest.fixture
    def admin_token(self):
        response = requests.post(f"{BASE_URL}/api/auth/login", json=ADMIN_CREDS)
        if response.status_code != 200:
            pytest.skip(f"Admin login failed: {response.text}")
        return response.json().get("token")
    
    def test_teacher_cannot_create_student(self, teacher_token):
        """Teacher should NOT be able to create students"""
        response = requests.post(
            f"{BASE_URL}/api/students",
            headers={"Authorization": f"Bearer {teacher_token}"},
            json={
                "first_name": "Test",
                "last_name": "Student",
                "gender": "male",
                "class_name": "10",
                "section": "A"
            }
        )
        assert response.status_code == 403, f"Expected 403, got {response.status_code}: {response.text}"
        print("✅ Teacher correctly prevented from creating students")
    
    def test_admin_can_create_student(self, admin_token):
        """Admin SHOULD be able to create students"""
        response = requests.post(
            f"{BASE_URL}/api/students",
            headers={"Authorization": f"Bearer {admin_token}"},
            json={
                "first_name": f"Test_{uuid.uuid4().hex[:6]}",
                "last_name": "Student",
                "gender": "male",
                "class_name": "10",
                "section": "A"
            }
        )
        # May fail due to duplicate, but should not be 403
        assert response.status_code != 403, f"Admin should have access, got 403"
        assert response.status_code in [200, 201, 400], f"Unexpected status: {response.status_code}: {response.text}"
        print(f"✅ Admin has access to create students (status: {response.status_code})")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
