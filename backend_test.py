#!/usr/bin/env python3
"""
Comprehensive Backend API Testing for Shemford School Management System
Tests all critical endpoints, authentication, and core functionalities.
"""

import requests
import json
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional

# Configuration
BASE_URL = "https://shemford-mobile.preview.emergentagent.com/api"
TIMEOUT = 30

class SchoolAPITester:
    def __init__(self):
        self.base_url = BASE_URL
        self.session = requests.Session()
        self.session.timeout = TIMEOUT
        
        # Test data tracking
        self.test_results = []
        self.auth_token = None
        self.test_user_id = None
        self.test_student_id = None
        self.test_employee_id = None
        self.test_fee_id = None
        
        # Statistics
        self.tests_run = 0
        self.tests_passed = 0
        self.critical_failures = []
        
    def log_test(self, name: str, success: bool, error: str = None, response_data: dict = None):
        """Log test result"""
        self.tests_run += 1
        if success:
            self.tests_passed += 1
            print(f"✅ {name}")
        else:
            print(f"❌ {name} - {error}")
            if "critical" in name.lower() or "auth" in name.lower():
                self.critical_failures.append(f"{name}: {error}")
        
        self.test_results.append({
            "name": name,
            "success": success,
            "error": error,
            "timestamp": datetime.now().isoformat(),
            "response_data": response_data
        })
    
    def make_request(self, method: str, endpoint: str, data: dict = None, 
                    expected_status: int = 200, headers: dict = None) -> tuple:
        """Make HTTP request and return (success, response_data, error)"""
        url = f"{self.base_url}{endpoint}"
        req_headers = {"Content-Type": "application/json"}
        
        if headers:
            req_headers.update(headers)
            
        if self.auth_token:
            req_headers["Authorization"] = f"Bearer {self.auth_token}"
        
        try:
            if method == "GET":
                response = requests.get(url, headers=req_headers, timeout=TIMEOUT)
            elif method == "POST":
                response = requests.post(url, json=data, headers=req_headers, timeout=TIMEOUT)
            elif method == "PUT":
                response = requests.put(url, json=data, headers=req_headers, timeout=TIMEOUT)
            elif method == "DELETE":
                response = requests.delete(url, headers=req_headers, timeout=TIMEOUT)
            
            success = response.status_code == expected_status
            
            try:
                response_data = response.json()
            except:
                response_data = {"raw_response": response.text}
            
            if not success:
                error = f"Status {response.status_code}, expected {expected_status}. Response: {response_data}"
            else:
                error = None
                
            return success, response_data, error
            
        except Exception as e:
            return False, {}, f"Request failed: {str(e)}"
    
    def test_health_check(self):
        """Test basic API health"""
        success, data, error = self.make_request("GET", "/health")
        self.log_test("Health Check", success, error, data)
        return success
    
    def test_auth_registration(self):
        """Test user registration"""
        test_email = f"test_admin_{datetime.now().strftime('%H%M%S')}@shemford.edu"
        user_data = {
            "name": "Test Admin User",
            "email": test_email,
            "password": "TestPassword123!",
            "role": "admin",
            "phone": "+91-9876543210"
        }
        
        success, data, error = self.make_request("POST", "/auth/register", user_data, 200)
        
        if success and "token" in data and "user" in data:
            self.auth_token = data["token"]
            self.test_user_id = data["user"]["user_id"]
            print(f"📋 Created test admin user: {test_email}")
        
        self.log_test("User Registration", success, error, data)
        return success
    
    def test_auth_login(self):
        """Test user login"""
        if not self.auth_token:
            self.log_test("User Login", False, "No registration token available")
            return False
            
        # Login with the same credentials used in registration
        test_email = f"test_admin_{datetime.now().strftime('%H%M%S')}@shemford.edu"
        login_data = {
            "email": test_email,
            "password": "TestPassword123!"
        }
        
        success, data, error = self.make_request("POST", "/auth/login", login_data, 200)
        
        if success and "token" in data:
            self.auth_token = data["token"]  # Update token
            
        self.log_test("User Login", success, error, data)
        return success
    
    def test_auth_me(self):
        """Test get current user info"""
        if not self.auth_token:
            self.log_test("Get User Info", False, "No auth token available")
            return False
            
        success, data, error = self.make_request("GET", "/auth/me")
        self.log_test("Get User Info", success, error, data)
        return success
    
    def test_classes_and_departments(self):
        """Test utility endpoints"""
        # Test classes endpoint
        success1, data1, error1 = self.make_request("GET", "/classes")
        self.log_test("Get Classes", success1, error1, data1)
        
        # Test subjects endpoint
        success2, data2, error2 = self.make_request("GET", "/subjects")
        self.log_test("Get Subjects", success2, error2, data2)
        
        # Test departments endpoint
        success3, data3, error3 = self.make_request("GET", "/departments")
        self.log_test("Get Departments", success3, error3, data3)
        
        return success1 and success2 and success3
    
    def test_student_management(self):
        """Test student CRUD operations"""
        if not self.auth_token:
            self.log_test("Student Management", False, "No auth token available")
            return False
        
        # Create student
        student_data = {
            "first_name": "Test",
            "last_name": "Student",
            "email": "test.student@example.com",
            "phone": "+91-9876543211",
            "date_of_birth": "2010-01-15",
            "gender": "male",
            "address": "Test Address, Test City",
            "class_name": "5",
            "section": "A",
            "roll_number": "05A001",
            "parent_name": "Test Parent",
            "parent_phone": "+91-9876543212",
            "parent_email": "test.parent@example.com"
        }
        
        success1, data1, error1 = self.make_request("POST", "/students", student_data, 200)
        if success1 and "student_id" in data1:
            self.test_student_id = data1["student_id"]
        self.log_test("Create Student", success1, error1, data1)
        
        # Get students
        success2, data2, error2 = self.make_request("GET", "/students")
        self.log_test("Get Students", success2, error2, data2)
        
        # Get specific student
        if self.test_student_id:
            success3, data3, error3 = self.make_request("GET", f"/students/{self.test_student_id}")
            self.log_test("Get Specific Student", success3, error3, data3)
        else:
            success3 = False
            self.log_test("Get Specific Student", False, "No student ID available")
        
        return success1 and success2 and success3
    
    def test_employee_management(self):
        """Test employee CRUD operations"""
        if not self.auth_token:
            self.log_test("Employee Management", False, "No auth token available")
            return False
        
        # Create employee
        employee_data = {
            "first_name": "Test",
            "last_name": "Employee",
            "email": "test.employee@shemford.edu",
            "phone": "+91-9876543213",
            "date_of_birth": "1985-05-20",
            "gender": "female",
            "address": "Employee Address, Test City",
            "designation": "Assistant Teacher",
            "department": "Teaching",
            "salary": 45000.0
        }
        
        success1, data1, error1 = self.make_request("POST", "/employees", employee_data, 200)
        if success1 and "employee_id" in data1:
            self.test_employee_id = data1["employee_id"]
        self.log_test("Create Employee", success1, error1, data1)
        
        # Get employees
        success2, data2, error2 = self.make_request("GET", "/employees")
        self.log_test("Get Employees", success2, error2, data2)
        
        # Get specific employee
        if self.test_employee_id:
            success3, data3, error3 = self.make_request("GET", f"/employees/{self.test_employee_id}")
            self.log_test("Get Specific Employee", success3, error3, data3)
        else:
            success3 = False
            self.log_test("Get Specific Employee", False, "No employee ID available")
        
        return success1 and success2 and success3
    
    def test_fee_management(self):
        """Test fee structure and payments"""
        if not self.auth_token:
            self.log_test("Fee Management", False, "No auth token available")
            return False
        
        # Create fee structure
        fee_structure = {
            "class_name": "5",
            "fee_type": "tuition",
            "amount": 5000.0,
            "academic_year": "2024-2025",
            "frequency": "monthly",
            "due_day": 10
        }
        
        success1, data1, error1 = self.make_request("POST", "/fees/structure", fee_structure, 200)
        if success1 and "fee_id" in data1:
            self.test_fee_id = data1["fee_id"]
        self.log_test("Create Fee Structure", success1, error1, data1)
        
        # Get fee structures
        success2, data2, error2 = self.make_request("GET", "/fees/structure")
        self.log_test("Get Fee Structures", success2, error2, data2)
        
        # Test fee payments endpoint (just GET, not creating payments yet)
        success3, data3, error3 = self.make_request("GET", "/fees/payments")
        self.log_test("Get Fee Payments", success3, error3, data3)
        
        # Test due chart
        success4, data4, error4 = self.make_request("GET", "/fees/due-chart")
        self.log_test("Get Due Chart", success4, error4, data4)
        
        return success1 and success2 and success3 and success4
    
    def test_announcements(self):
        """Test announcements functionality"""
        if not self.auth_token:
            self.log_test("Announcements", False, "No auth token available")
            return False
        
        # Create announcement
        announcement = {
            "title": "Test Announcement",
            "content": "This is a test announcement for the school management system.",
            "target_type": "all",
            "priority": "normal"
        }
        
        success1, data1, error1 = self.make_request("POST", "/announcements", announcement, 200)
        self.log_test("Create Announcement", success1, error1, data1)
        
        # Get announcements
        success2, data2, error2 = self.make_request("GET", "/announcements")
        self.log_test("Get Announcements", success2, error2, data2)
        
        return success1 and success2
    
    def test_syllabus_management(self):
        """Test syllabus functionality"""
        if not self.auth_token:
            self.log_test("Syllabus Management", False, "No auth token available")
            return False
        
        # Create syllabus
        syllabus = {
            "class_name": "5",
            "subject": "Mathematics",
            "title": "Mathematics Syllabus - Class 5",
            "description": "Complete mathematics syllabus for class 5 students",
            "academic_year": "2024-2025"
        }
        
        success1, data1, error1 = self.make_request("POST", "/syllabus", syllabus, 200)
        self.log_test("Create Syllabus", success1, error1, data1)
        
        # Get syllabus
        success2, data2, error2 = self.make_request("GET", "/syllabus")
        self.log_test("Get Syllabus", success2, error2, data2)
        
        return success1 and success2
    
    def test_issues_tracking(self):
        """Test issue tracking system"""
        if not self.auth_token:
            self.log_test("Issues Tracking", False, "No auth token available")
            return False
        
        # Create issue
        issue = {
            "title": "Test Issue - Network Problem",
            "description": "Test issue for network connectivity problems in computer lab",
            "category": "facility",
            "priority": "normal"
        }
        
        success1, data1, error1 = self.make_request("POST", "/issues", issue, 200)
        self.log_test("Create Issue", success1, error1, data1)
        
        # Get issues
        success2, data2, error2 = self.make_request("GET", "/issues")
        self.log_test("Get Issues", success2, error2, data2)
        
        return success1 and success2
    
    def test_messaging(self):
        """Test messaging functionality"""
        if not self.auth_token:
            self.log_test("Messaging", False, "No auth token available")
            return False
        
        # Send message
        message = {
            "subject": "Test Message",
            "content": "This is a test message from the automated testing system.",
            "recipient_type": "all",
            "message_type": "text"
        }
        
        success1, data1, error1 = self.make_request("POST", "/messages", message, 200)
        self.log_test("Send Message", success1, error1, data1)
        
        # Get messages
        success2, data2, error2 = self.make_request("GET", "/messages")
        self.log_test("Get Messages", success2, error2, data2)
        
        return success1 and success2
    
    def test_reports_dashboard(self):
        """Test dashboard and reports"""
        if not self.auth_token:
            self.log_test("Reports Dashboard", False, "No auth token available")
            return False
        
        # Get dashboard stats
        success1, data1, error1 = self.make_request("GET", "/reports/dashboard")
        self.log_test("Get Dashboard Stats", success1, error1, data1)
        
        # Get financial report
        success2, data2, error2 = self.make_request("GET", "/reports/financial")
        self.log_test("Get Financial Report", success2, error2, data2)
        
        return success1 and success2
    
    def test_user_management(self):
        """Test user management (admin only)"""
        if not self.auth_token:
            self.log_test("User Management", False, "No auth token available")
            return False
        
        # Get users
        success1, data1, error1 = self.make_request("GET", "/users")
        self.log_test("Get Users", success1, error1, data1)
        
        return success1
    
    def run_all_tests(self):
        """Run all test suites"""
        print(f"🚀 Starting Comprehensive Backend API Testing")
        print(f"🎯 Base URL: {self.base_url}")
        print("=" * 60)
        
        # Basic connectivity
        if not self.test_health_check():
            print("❌ Health check failed - API may be down")
            return False
        
        # Authentication flow
        print("\n🔐 Authentication Tests")
        auth_success = (
            self.test_auth_registration() and 
            self.test_auth_me()
        )
        
        if not auth_success:
            print("❌ Authentication failed - cannot proceed with protected endpoints")
            return False
        
        # Core functionality tests
        print("\n📚 Core Functionality Tests")
        self.test_classes_and_departments()
        self.test_student_management()
        self.test_employee_management()
        self.test_fee_management()
        
        print("\n📢 Communication Tests")
        self.test_announcements()
        self.test_messaging()
        
        print("\n📖 Academic Tests")
        self.test_syllabus_management()
        self.test_issues_tracking()
        
        print("\n📊 Analytics Tests")
        self.test_reports_dashboard()
        self.test_user_management()
        
        return True
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        print(f"Total Tests: {self.tests_run}")
        print(f"Passed: {self.tests_passed}")
        print(f"Failed: {self.tests_run - self.tests_passed}")
        print(f"Success Rate: {(self.tests_passed / self.tests_run * 100):.1f}%")
        
        if self.critical_failures:
            print(f"\n⚠️  CRITICAL FAILURES ({len(self.critical_failures)}):")
            for failure in self.critical_failures:
                print(f"  • {failure}")
        
        # Save detailed results
        results_file = f"/app/test_reports/backend_test_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_file, 'w') as f:
            json.dump({
                "summary": {
                    "total_tests": self.tests_run,
                    "passed": self.tests_passed,
                    "failed": self.tests_run - self.tests_passed,
                    "success_rate": self.tests_passed / self.tests_run * 100,
                    "critical_failures": self.critical_failures,
                    "timestamp": datetime.now().isoformat()
                },
                "detailed_results": self.test_results
            }, f, indent=2)
        
        print(f"\n📄 Detailed results saved to: {results_file}")
        
        return self.tests_passed == self.tests_run

def main():
    """Main test execution"""
    print("🏫 Shemford School Management System - Backend API Testing")
    print("=" * 60)
    
    tester = SchoolAPITester()
    
    try:
        success = tester.run_all_tests()
        test_passed = tester.print_summary()
        
        if test_passed:
            print("\n✅ All tests passed successfully!")
            return 0
        elif len(tester.critical_failures) > 0:
            print(f"\n❌ Critical failures detected! ({len(tester.critical_failures)} issues)")
            return 2
        else:
            print(f"\n⚠️  Some tests failed but no critical issues")
            return 1
            
    except Exception as e:
        print(f"\n💥 Test execution failed: {str(e)}")
        return 3

if __name__ == "__main__":
    sys.exit(main())