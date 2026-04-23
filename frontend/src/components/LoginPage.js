import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Mail, Lock, User, Phone, ArrowLeft, KeyRound, CheckCircle, GraduationCap, Shield, Zap } from 'lucide-react';
import { toast } from 'sonner';
import api from '../lib/api';

const LOGO_URL = "/logo.webp";

/* ── Reusable form field ── */
const Field = ({ label, icon: Icon, ...inputProps }) => (
  <div className="space-y-1.5">
    <Label className="text-xs font-semibold text-slate-700 block">{label}</Label>
    <div className="relative">
      {Icon && (
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" strokeWidth={1.5} />
      )}
      <Input
        className={`${Icon ? 'pl-10' : ''} h-12 rounded-xl border-slate-200 bg-slate-50 focus:bg-white focus:border-[#E88A1A] focus:ring-2 focus:ring-[#E88A1A]/10 text-sm transition-all`}
        {...inputProps}
      />
    </div>
  </div>
);

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, register, loginWithGoogle, googleAuthEnabled } = useAuth();

  const [isLoading, setIsLoading]             = useState(false);
  const [showForgotPassword, setShowForgot]   = useState(false);
  const [forgotEmail, setForgotEmail]         = useState('');
  const [resetToken, setResetToken]           = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmNewPassword, setConfirmNew]   = useState('');
  const [resetStep, setResetStep]             = useState('email');
  const [loginData, setLoginData]             = useState({ email: '', password: '' });
  const [registerData, setRegisterData]       = useState({ name: '', email: '', password: '', confirmPassword: '', phone: '' });

  const handleLogin = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await login(loginData.email, loginData.password);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (error) {
      const d = error.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Login failed');
    } finally { setIsLoading(false); }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (registerData.password !== registerData.confirmPassword) { toast.error('Passwords do not match'); return; }
    setIsLoading(true);
    try {
      await register({ name: registerData.name, email: registerData.email, password: registerData.password, role: 'parent', phone: registerData.phone || undefined });
      toast.success('Account created!');
      navigate('/dashboard');
    } catch (error) {
      const d = error.response?.data?.detail;
      toast.error(typeof d === 'string' ? d : 'Registration failed');
    } finally { setIsLoading(false); }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await api.post('/auth/forgot-password', { email: forgotEmail });
      setResetStep('reset');
      toast.success('Check your email for a reset token.');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Email not found');
    } finally { setIsLoading(false); }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (newPassword !== confirmNewPassword) { toast.error('Passwords do not match'); return; }
    setIsLoading(true);
    try {
      await api.post('/auth/reset-password', { token: resetToken, new_password: newPassword });
      setResetStep('success');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Failed to reset password');
    } finally { setIsLoading(false); }
  };

  const closeReset = () => { setShowForgot(false); setResetStep('email'); setForgotEmail(''); setNewPassword(''); setConfirmNew(''); setResetToken(''); };

  return (
    <div className="min-h-screen flex" data-testid="login-page">

      {/* ── Left: Brand panel ── */}
      <div className="hidden lg:flex lg:w-[52%] relative overflow-hidden bg-[#0F172A] flex-col justify-between p-12">

        {/* Background glow blobs */}
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#E88A1A]/8 rounded-full -translate-y-1/2 translate-x-1/3 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#E88A1A]/10 rounded-full translate-y-1/3 -translate-x-1/4 blur-2xl pointer-events-none" />
        <div className="absolute top-1/2 right-1/3 w-48 h-48 bg-blue-500/5 rounded-full blur-2xl pointer-events-none" />

        {/* Geometric accents */}
        <div className="absolute top-10 right-10 w-24 h-24 border border-[#E88A1A]/15 rounded-3xl rotate-12 pointer-events-none" />
        <div className="absolute top-20 right-20 w-12 h-12 border border-white/5 rounded-xl rotate-45 pointer-events-none" />
        <div className="absolute bottom-28 right-16 w-16 h-16 border border-[#E88A1A]/10 rounded-2xl -rotate-12 pointer-events-none" />
        <div className="absolute top-1/3 right-6 w-px h-32 bg-gradient-to-b from-transparent via-[#E88A1A]/30 to-transparent pointer-events-none" />

        {/* Logo */}
        <img src={LOGO_URL} alt="Shemford" className="h-12 w-auto object-contain relative z-10" />

        {/* Main content */}
        <div className="relative z-10">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-[#E88A1A]/10 border border-[#E88A1A]/20 rounded-full px-3.5 py-1.5 mb-6">
            <div className="h-1.5 w-1.5 rounded-full bg-[#E88A1A]" />
            <span className="text-[#E88A1A] text-xs font-bold uppercase tracking-widest">School Management System</span>
          </div>

          <h1 className="text-5xl font-bold text-white leading-[1.1] tracking-tight mb-5">
            Shemford<br />
            <span className="text-[#E88A1A]">Futuristic</span><br />
            School
          </h1>
          <p className="text-slate-400 text-base max-w-sm leading-relaxed">
            Enterprise platform for modern education. Manage students, staff, fees, attendance, and more — all in one place.
          </p>
        </div>

        {/* Feature pills */}
        <div className="relative z-10 flex flex-wrap gap-3">
          {[
            { icon: Shield,        label: 'Secure Login',       color: 'text-emerald-400', dot: 'bg-emerald-500' },
            { icon: GraduationCap, label: 'Role-Based Access',  color: 'text-blue-400',    dot: 'bg-blue-500' },
            { icon: Zap,           label: 'Real-Time Updates',  color: 'text-orange-400',  dot: 'bg-[#E88A1A]' },
          ].map(({ icon: Icon, label, color, dot }) => (
            <div key={label} className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2">
              <div className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              <span className={`text-xs font-medium ${color}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right: Form panel ── */}
      <div className="w-full lg:w-[48%] flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="lg:hidden mb-8">
            <img src={LOGO_URL} alt="Shemford" className="h-10 w-auto object-contain" />
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-slate-900">Welcome back</h2>
            <p className="text-slate-500 text-sm mt-1">Sign in to your school portal</p>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-7 rounded-xl h-11 bg-slate-100 p-1">
              <TabsTrigger value="login"    className="rounded-lg text-xs font-bold uppercase tracking-wider" data-testid="login-tab">Sign In</TabsTrigger>
              <TabsTrigger value="register" className="rounded-lg text-xs font-bold uppercase tracking-wider" data-testid="register-tab">Register</TabsTrigger>
            </TabsList>

            {/* ── Sign In ── */}
            <TabsContent value="login">
              <form onSubmit={handleLogin} className="space-y-4">
                <Field label="Email Address" icon={Mail}  type="email"    placeholder="Enter your email"    value={loginData.email}    onChange={e => setLoginData({ ...loginData, email: e.target.value })}    required data-testid="login-email-input" />
                <Field label="Password"      icon={Lock}  type="password" placeholder="Enter your password" value={loginData.password}  onChange={e => setLoginData({ ...loginData, password: e.target.value })} required data-testid="login-password-input" />

                <Button
                  type="submit"
                  className="w-full bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl h-12 font-bold text-sm shadow-lg shadow-orange-200/60 transition-all mt-2"
                  disabled={isLoading}
                  data-testid="login-submit-btn"
                >
                  {isLoading ? 'Signing in…' : 'Sign In'}
                </Button>

                <button
                  type="button"
                  className="w-full text-xs text-slate-400 hover:text-[#E88A1A] transition-colors text-center py-1 font-medium"
                  onClick={() => setShowForgot(true)}
                  data-testid="forgot-password-link"
                >
                  Forgot your password?
                </button>
              </form>

              {googleAuthEnabled && (
                <>
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-3 text-xs text-slate-400 font-medium uppercase tracking-wider">or</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full rounded-xl h-12 border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700"
                    onClick={loginWithGoogle}
                    data-testid="google-login-btn"
                  >
                    Sign in with Google
                  </Button>
                </>
              )}
            </TabsContent>

            {/* ── Register ── */}
            <TabsContent value="register">
              <form onSubmit={handleRegister} className="space-y-4">
                <Field label="Full Name" icon={User}  placeholder="Enter your full name" value={registerData.name}            onChange={e => setRegisterData({ ...registerData, name: e.target.value })}            required data-testid="register-name-input" />
                <Field label="Email"     icon={Mail}  type="email" placeholder="Enter your email"     value={registerData.email}           onChange={e => setRegisterData({ ...registerData, email: e.target.value })}           required data-testid="register-email-input" />
                <Field label="Phone"     icon={Phone} placeholder="Optional"               value={registerData.phone}           onChange={e => setRegisterData({ ...registerData, phone: e.target.value })}                    data-testid="register-phone-input" />

                <p className="text-[11px] text-slate-400 bg-slate-50 rounded-xl px-3 py-2.5 border border-slate-200">
                  Parent accounts only. Staff accounts are created by the administrator.
                </p>

                <Field label="Password"         icon={Lock} type="password" placeholder="Create a password"  value={registerData.password}        onChange={e => setRegisterData({ ...registerData, password: e.target.value })}        required data-testid="register-password-input" />
                <Field label="Confirm Password"  icon={Lock} type="password" placeholder="Confirm your password" value={registerData.confirmPassword}  onChange={e => setRegisterData({ ...registerData, confirmPassword: e.target.value })} required data-testid="register-confirm-input" />

                <Button
                  type="submit"
                  className="w-full bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl h-12 font-bold text-sm shadow-lg shadow-orange-200/60 transition-all"
                  disabled={isLoading}
                  data-testid="register-submit-btn"
                >
                  {isLoading ? 'Creating…' : 'Create Account'}
                </Button>
              </form>

              {googleAuthEnabled && (
                <>
                  <div className="relative my-6">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-slate-200" />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-white px-3 text-xs text-slate-400 font-medium uppercase tracking-wider">or</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="w-full rounded-xl h-12 border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-xs font-bold uppercase tracking-wider text-slate-700"
                    onClick={loginWithGoogle}
                    data-testid="google-register-btn"
                  >
                    Sign up with Google
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ── Forgot Password modal ── */}
      {showForgotPassword && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
          data-testid="forgot-password-dialog"
        >
          <Card className="w-full max-w-sm border border-slate-200 shadow-2xl rounded-2xl animate-scale-in">
            <CardHeader className="pb-4">
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={closeReset}
                  className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <CardTitle className="text-lg font-bold text-slate-900">Reset Password</CardTitle>
              </div>

              {resetStep !== 'success' && (
                <div className="flex items-center gap-2 mb-1">
                  <div className="h-1.5 flex-1 rounded-full bg-[#E88A1A]" />
                  <div className={`h-1.5 flex-1 rounded-full ${resetStep === 'reset' ? 'bg-[#E88A1A]' : 'bg-slate-200'}`} />
                  <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                    Step {resetStep === 'email' ? '1' : '2'} of 2
                  </span>
                </div>
              )}

              <CardDescription className="text-xs text-slate-500 mt-1">
                {resetStep === 'email'   ? 'Enter your registered email address' :
                 resetStep === 'reset'   ? 'Enter the token from your email and set a new password' :
                                           'Your password has been reset successfully'}
              </CardDescription>
            </CardHeader>

            <CardContent>
              {resetStep === 'success' ? (
                <div className="text-center py-4">
                  <div className="h-16 w-16 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-5">
                    <CheckCircle className="h-8 w-8 text-emerald-600" strokeWidth={1.5} />
                  </div>
                  <h3 className="font-bold text-slate-900 mb-1">Password Reset!</h3>
                  <p className="text-sm text-slate-500 mb-6">Your password has been updated. You can now sign in.</p>
                  <Button
                    className="w-full bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl h-11 font-bold text-sm"
                    onClick={closeReset}
                  >
                    Go to Sign In
                  </Button>
                </div>

              ) : resetStep === 'email' ? (
                <form onSubmit={handleForgotPassword} className="space-y-4">
                  <Field label="Email" icon={Mail} type="email" placeholder="Enter your email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} required data-testid="forgot-email-input" />
                  <Button
                    type="submit"
                    className="w-full bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl h-11 font-bold text-sm"
                    disabled={isLoading}
                    data-testid="forgot-submit-btn"
                  >
                    {isLoading ? 'Processing…' : 'Send Reset Token'}
                  </Button>
                </form>

              ) : (
                <form onSubmit={handleResetPassword} className="space-y-4">
                  <div className="flex items-center gap-3 p-3 bg-orange-50 border border-orange-200 rounded-xl">
                    <KeyRound className="h-4 w-4 text-[#E88A1A] shrink-0" strokeWidth={1.5} />
                    <p className="text-xs text-slate-600">Enter the reset token from your email and set a new password.</p>
                  </div>
                  <Field label="Reset Token"    icon={KeyRound} placeholder="Paste reset token"    value={resetToken}   onChange={e => setResetToken(e.target.value)}   required data-testid="reset-token-input" />
                  <Field label="New Password"   icon={Lock}     type="password" placeholder="Enter new password"    value={newPassword}  onChange={e => setNewPassword(e.target.value)}  required data-testid="new-password-input" />
                  <Field label="Confirm"        icon={Lock}     type="password" placeholder="Confirm new password"  value={confirmNewPassword} onChange={e => setConfirmNew(e.target.value)} required data-testid="confirm-new-password-input" />
                  <Button
                    type="submit"
                    className="w-full bg-[#E88A1A] hover:bg-[#C97516] text-white rounded-xl h-11 font-bold text-sm"
                    disabled={isLoading}
                    data-testid="reset-submit-btn"
                  >
                    {isLoading ? 'Resetting…' : 'Reset Password'}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default LoginPage;
