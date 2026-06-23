import type { Metadata } from 'next';
import './globals.css';
import { LogoutButton } from './LogoutButton';

export const metadata: Metadata = {
  title: '자금수지현황 관리 시스템',
  description: '피드백 · 상생 · 슛문 자금 관리',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <nav className="nav">
          <a href="/" className="nav-brand">자금수지현황 관리 시스템</a>
          <a href="/cashflow"         className="nav-link">자금수지현황표</a>
          <a href="/cashflow/matched" className="nav-link">매칭 완료</a>
          <a href="/upload"           className="nav-link">파일 업로드</a>
          <a href="/unmatched"        className="nav-link">미매칭 검토</a>
          <a href="/vendors"          className="nav-link">거래처 관리</a>
          <a href="/interest"         className="nav-link">이자 관리</a>
          <a href="/dashboard"        className="nav-link">대시보드</a>
          <LogoutButton />
        </nav>
        {children}
      </body>
    </html>
  );
}
