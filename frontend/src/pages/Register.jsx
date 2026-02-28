import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, User, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { GoogleLogin } from '@react-oauth/google';
import authService from '../services/authService';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';

// 1. Define your validation schema outside the component to prevent recreation on re-renders
const registerSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters'),
  email: z.email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
  terms: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to the terms' })
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"], // This attaches the error directly to the confirmPassword field
});

function Register() {
  // 2. Initialize React Hook Form
  const {
    register, // This is RHF's register function to bind inputs
    handleSubmit,
    setError, // Useful for setting backend errors manually
    formState: { errors, isSubmitting }, // isSubmitting replaces your manual 'loading' state
  } = useForm({
    resolver: zodResolver(registerSchema),
  });

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const navigate = useNavigate();

  // 3. Alias your context 'register' to 'authRegister' to avoid clashing with RHF's 'register'
  const { register: authRegister, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // 4. onSubmit only runs if Zod validation passes. You just get the clean data.
  const onSubmit = async (data) => {
    try {
      const result = await authRegister(data.username, data.email, data.password);

      if (!result.success) {
        // Set a global form error from the Django backend response
        setError('root.serverError', {
          type: 'server',
          message: result.error || 'Registration failed. Please try again.'
        });
      }
    } catch (err) {
      console.error('Registration error:', err);
      setError('root.serverError', {
        type: 'server',
        message: 'An unexpected error occurred. Please try again.'
      });
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    try {
      const result = await authService.googleLogin(credentialResponse.credential);
      if (!result.success) {
        setError('root.serverError', { message: result.error || 'Google sign up failed' });
      }
    } catch (err) {
      setError('root.serverError', { message: 'An unexpected error occurred with Google signup' });
    }
  };

  const handleGoogleError = () => {
    setError('root.serverError', { message: 'Google signup failed. Please try again.' });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        <div className="text-center mb-8">
          <div className="text-6xl mb-4">♔</div>
          <h1 className="text-4xl font-bold text-white mb-2">ChessHub</h1>
          <p className="text-white/60">Join thousands of chess players worldwide</p>
        </div>

        <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-8 shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-6">Create Account</h2>

          {/* Display Server Errors */}
          {errors.root?.serverError && (
            <div className="bg-red-500/20 border border-red-500/50 text-red-200 rounded-lg p-3 mb-4 text-sm">
              {errors.root.serverError.message}
            </div>
          )}

          {/* Pass handleSubmit to the form */}
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

            {/* Username */}
            <div>
              <label className="block text-white/80 text-sm font-medium mb-2">Username</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40 w-5 h-5" />
                <input
                  type="text"
                  {...register('username')} // Bind input
                  className="w-full bg-white/10 border border-white/20 rounded-lg pl-10 pr-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="chessmaster123"
                  disabled={isSubmitting}
                />
              </div>
              {errors.username && <p className="text-red-400 text-xs mt-1">{errors.username.message}</p>}
            </div>

            {/* Email */}
            <div>
              <label className="block text-white/80 text-sm font-medium mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40 w-5 h-5" />
                <input
                  type="email"
                  {...register('email')} // Bind input
                  className="w-full bg-white/10 border border-white/20 rounded-lg pl-10 pr-4 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="your@email.com"
                  disabled={isSubmitting}
                />
              </div>
              {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email.message}</p>}
            </div>

            {/* Password */}
            <div>
              <label className="block text-white/80 text-sm font-medium mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40 w-5 h-5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  {...register('password')} // Bind input
                  className="w-full bg-white/10 border border-white/20 rounded-lg pl-10 pr-12 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="••••••••"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white/60"
                  disabled={isSubmitting}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password.message}</p>}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-white/80 text-sm font-medium mb-2">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-white/40 w-5 h-5" />
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  {...register('confirmPassword')} // Bind input
                  className="w-full bg-white/10 border border-white/20 rounded-lg pl-10 pr-12 py-3 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  placeholder="••••••••"
                  disabled={isSubmitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white/60"
                  disabled={isSubmitting}
                >
                  {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {errors.confirmPassword && <p className="text-red-400 text-xs mt-1">{errors.confirmPassword.message}</p>}
            </div>

            {/* Terms */}
            <div className="flex items-start">
              <div className="flex flex-col">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="terms"
                    {...register('terms')} // Bind input
                    className="mt-1 w-4 h-4 rounded border-white/20 bg-white/10 text-purple-600 focus:ring-purple-500"
                    disabled={isSubmitting}
                  />
                  <label htmlFor="terms" className="ml-2 text-white/60 text-sm">
                    I agree to the{' '}
                    <Link to="/terms" className="text-purple-400 hover:text-purple-300">Terms of Service</Link>{' '}
                    and{' '}
                    <Link to="/privacy" className="text-purple-400 hover:text-purple-300">Privacy Policy</Link>
                  </label>
                </div>
                {errors.terms && <p className="text-red-400 text-xs mt-1">{errors.terms.message}</p>}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg py-3 font-semibold transition-all duration-300 hover:scale-105 shadow-lg disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></div>
                  Creating account...
                </span>
              ) : (
                <span className="flex items-center justify-center">
                  <UserPlus className="w-5 h-5 mr-2" />
                  Create Account
                </span>
              )}
            </button>
          </form>

          <div className="flex items-center my-6">
            <div className="flex-1 border-t border-white/20"></div>
            <span className="px-4 text-white/40 text-sm">or</span>
            <div className="flex-1 border-t border-white/20"></div>
          </div>

          <div className="mt-4">
            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              useOneTap={false}
              theme="filled_black"
              size="large"
              text="signup_with"
              shape="rectangular"
              logo_alignment="left"
              width="100%"
            />
          </div>

          <p className="text-center text-white/60 text-sm mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-purple-400 hover:text-purple-300 font-semibold">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

export default Register;