# How to View Draft Onboarding Applications

## Backend Endpoint Reference

### List All Draft Onboarding Applications
```
GET /api/onboarding/draft/list
Authorization: Bearer <ADMIN_TOKEN>
```

**Response Example:**
```json
{
  "total": 3,
  "draft_applications": [
    {
      "onboarding_id": "ONB-20250317-001",
      "first_name": "Raj",
      "last_name": "Kumar",
      "gender": "male",
      "date_of_birth": "2010-05-15",
      "parent_name": "Vikram Kumar",
      "parent_phone": "9876543210",
      "mother_name": "Priya Kumar",
      "mother_phone": "9876543211",
      "status": "draft",
      "created_at": "2025-03-17T10:30:00Z",
      "document_count": 2
    },
    {
      "onboarding_id": "ONB-20250317-002",
      "first_name": "Ananya",
      "last_name": "Singh",
      "gender": "female",
      "date_of_birth": "2011-08-22",
      "parent_name": "Rohit Singh",
      "parent_phone": "9876543220",
      "mother_name": "Sneha Singh",
      "mother_phone": "9876543221",
      "status": "draft",
      "created_at": "2025-03-17T09:15:00Z",
      "document_count": 0
    }
  ]
}
```

## Frontend Implementation Example

### Using Axios (React Component)
```javascript
import { useState, useEffect } from 'react';
import axios from 'axios';

const DraftApplicationsPage = () => {
  const [draftApps, setDraftApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchDraftApplications = async () => {
      try {
        setLoading(true);
        const response = await axios.get('/api/onboarding/draft/list', {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('auth_token')}`,
          },
          withCredentials: true,
        });
        setDraftApps(response.data.draft_applications);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch draft applications:', err);
        setError(err.response?.data?.detail || 'Failed to load draft applications');
      } finally {
        setLoading(false);
      }
    };

    fetchDraftApplications();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div className="error">{error}</div>;

  return (
    <div className="draft-applications">
      <h2>Incomplete Onboarding Applications ({draftApps.length})</h2>
      
      {draftApps.length === 0 ? (
        <p>No draft applications found. All onboarding is complete!</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>Documents</th>
              <th>Created</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {draftApps.map((app) => (
              <tr key={app.onboarding_id}>
                <td>
                  {app.first_name} {app.last_name}
                </td>
                <td>{app.parent_phone}</td>
                <td>{app.document_count} uploaded</td>
                <td>{new Date(app.created_at).toLocaleDateString()}</td>
                <td>
                  <button onClick={() => resumeOnboarding(app.onboarding_id)}>
                    Resume
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

const resumeOnboarding = (onboardingId) => {
  // Navigate to onboarding step 2 (class selection)
  window.location.href = `/onboarding/${onboardingId}?step=2`;
};

export default DraftApplicationsPage;
```

## Testing in Browser Console

```javascript
// Test fetching draft applications
fetch('/api/onboarding/draft/list', {
  headers: {
    'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
  },
  credentials: 'include',
})
  .then(res => res.json())
  .then(data => console.log('Draft apps:', data))
  .catch(err => console.error('Error:', err));
```

## cURL Command for Testing

```bash
# Get draft applications
curl http://localhost:8000/api/onboarding/draft/list \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN_HERE" \
  -H "Content-Type: application/json"

# Example response:
# {
#   "total": 3,
#   "draft_applications": [...]
# }
```

## Integration Points

### 1. **Admin Dashboard**
Add a widget showing count of draft applications:
```javascript
const draftCount = draftApps.length;
<div className="dashboard-widget">
  <h3>{draftCount} Incomplete Onboardings</h3>
  <Link to="/draft-applications">View & Resume</Link>
</div>
```

### 2. **Students Page**
Add a filter to show draft vs completed:
```javascript
const [filterStatus, setFilterStatus] = useState('all'); // 'all', 'draft', 'completed'

// Add to status filter options:
<option value="draft">Draft (Incomplete)</option>
<option value="completed">Completed</option>
```

### 3. **Bulk Actions**
Email reminders to parents of students in draft status:
```javascript
const sendReminders = async () => {
  for (const app of draftApps) {
    await sendEmail({
      to: app.parent_email || app.parent_phone,
      subject: 'Complete Your Child\'s Onboarding',
      body: `Dear ${app.parent_name}, please complete onboarding for ${app.first_name}...`,
    });
  }
};
```

---

## Status Values Reference

- **draft**: Started but not completed (no class assigned)
- **class_selected**: Class & section selected, waiting for documents
- **docs_uploaded**: Documents uploaded, waiting for fee collection
- **fee_collected**: Fees collected, pending final confirmation
- **completed**: Fully onboarded, student is active

To filter by other statuses, modify the endpoint. Currently it only returns `draft`.
