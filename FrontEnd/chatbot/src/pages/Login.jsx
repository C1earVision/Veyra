import { useState } from 'react';
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { API_URL } from "../config/api";

const Login = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const url = `${API_URL}/auth/login`;
      const user = await axios.post(url, {
        email: email,
        password: password,
      });
      localStorage.setItem('user', JSON.stringify(user.data));
      navigate('/agent');
    } catch (err) {
      const msg =
        err.response?.data?.msg ||
        err.response?.data?.message ||
        (err.response?.status === 403
          ? 'Access restricted to business owners / administrators.'
          : null);
      setError(msg || 'Invalid email or password.');
      console.error('Error logging in:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0F1117] px-4">
      <div className="w-full max-w-[360px]">
        {/* Brand */}
        <div className="mb-10">
          <h1 className="text-[22px] font-semibold text-[#F3F4F6] tracking-tight">
            Veyra
          </h1>
          <p className="mt-1 text-[13px] text-[#9CA3AF]">
            Sign in to your account
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 px-3 py-2.5 text-[13px] text-red-400 bg-red-400/8 border border-red-400/20 rounded-md">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-[13px] font-medium text-[#9CA3AF] mb-1.5"
            >
              Email
            </label>
            <input
              type="email"
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 text-[14px] text-[#F3F4F6] bg-[#151820] border border-[#272B35] rounded-md placeholder-[#4B5563] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              placeholder="akali@gmail.com"
              required
              autoComplete="email"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-[13px] font-medium text-[#9CA3AF] mb-1.5"
            >
              Password
            </label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 text-[14px] text-[#F3F4F6] bg-[#151820] border border-[#272B35] rounded-md placeholder-[#4B5563] focus:outline-none focus:border-[#2563EB] focus:ring-1 focus:ring-[#2563EB] transition-colors"
              placeholder="akali"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 px-4 py-2 text-[14px] font-medium text-white bg-[#2563EB] rounded-md hover:bg-[#1D4ED8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;