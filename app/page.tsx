export default function Home() {
  return (
    <div className="home-wrap">
      <h1 className="home-title">자금수지현황 관리 시스템</h1>
      <p className="home-desc">피드백 · 상생 · 슛문 자금 관리</p>
      <div className="home-buttons">
        <a href="/cashflow"  className="btn">자금수지현황표</a>
        <a href="/unmatched" className="btn btn-outline">미매칭 검토</a>
        <a href="/dashboard" className="btn btn-outline">대시보드</a>
      </div>
    </div>
  );
}
