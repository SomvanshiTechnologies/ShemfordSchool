import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2 } from 'lucide-react';

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  // If user passed from AuthCallback, skip auth check
  if (location.state?.user) {
    return children;
  }

  // Auth check still in flight — if a token exists we optimistically render
  // the page rather than showing a blank screen. If auth ultimately fails,
  // the response interceptor in api.js redirects to /login.
  const hasToken = !!localStorage.getItem('auth_token');
  if (loading) {
    if (hasToken) return children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
      </div>
    );
  }

  // Not authenticated, redirect to login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Check role permissions if specified
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;
