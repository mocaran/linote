import Script from "next/script";

export default function NotesPage({accountName, accountEmail, signOutPath}: {accountName:string; accountEmail:string; signOutPath:string}) {
  return <>
    <link rel="stylesheet" href="/styles.css" /><link rel="stylesheet" href="/overrides.css" />
    <div className="app-shell">
      <div className="mobile-shade" id="mobileShade" hidden></div>
      <aside className="sidebar" id="sidebar">
        <div className="brand"><div><strong>linote</strong><small>保卫个人史</small></div></div>
        <div className="mini-stats"><div className="mini-stats-title"><span>记录日历</span><strong id="todayCount">今日 0 条</strong></div><div className="mini-calendar" id="miniCalendar" aria-label="最近 35 天笔记数量"></div><div className="mini-stats-foot"><span>近 35 天</span><span id="totalStats">共 0 条笔记</span></div></div>
        <button className="new-button" id="newNoteSidebar" type="button"><span aria-hidden="true">＋</span> 写一条笔记 <kbd>N</kbd></button>
        <div className="side-section"><button className="nav-item active" id="allNotes" type="button"><span className="nav-icon">▦</span><span>全部笔记</span><span className="nav-count" id="allCount">0</span></button></div>
        <div className="side-section topic-section"><div className="section-heading"><span>话题</span><button type="button" id="sortButton" title="切换话题排序" aria-label="切换话题排序">笔记数 ↓</button></div><div className="topic-list" id="topicList"></div><p className="topic-hint" id="topicHint">添加话题后，会自动出现在这里。</p></div>
        <div className="sidebar-bottom"><span className="account-name" title={accountEmail}>{accountName}</span><a href={signOutPath} target="_top">退出</a><button type="button" id="exportButton">导出</button></div>
      </aside>
      <main className="main"><header className="topbar"><button className="mobile-menu" type="button" id="mobileMenu" aria-label="打开菜单">☰</button><div className="crumb"><strong id="pageTitle">全部笔记</strong></div><div className="top-actions"><label className="search"><span aria-hidden="true">⌕</span><input id="searchInput" type="search" placeholder="搜索笔记或话题" aria-label="搜索笔记或话题"/><kbd>Ctrl K</kbd></label><button className="top-new" id="newNoteTop" type="button">＋ <span>新笔记</span></button></div></header>
        <div className="content"><div className="feed-heading"><div><strong id="resultCount">0 条笔记</strong><span id="filterLabel">按最近编辑排序</span></div><button type="button" id="clearFilter" hidden>清除筛选 ×</button></div><section className="notes" id="notes" aria-live="polite"></section><section className="empty" id="empty"><h2 id="emptyTitle">从一条笔记开始</h2><p id="emptyText">把稍纵即逝的想法留在这里。</p><button type="button" id="emptyNew">写第一条笔记 <span>↗</span></button></section></div>
      </main>
    </div>
    <div className="modal-layer" id="modalLayer" hidden><div className="modal-backdrop" id="modalBackdrop"></div><section className="editor" role="dialog" aria-modal="true" aria-labelledby="editorTitle"><div className="editor-header"><h2 id="editorTitle">写一条笔记</h2><button type="button" id="closeEditor" aria-label="关闭编辑器">×</button></div><form id="noteForm"><textarea id="noteBody" placeholder="现在的想法是…" maxLength={20000} required></textarea><div className="tag-area"><div className="tag-title"><span>#</span> 添加话题 <small>一条笔记可以有多个话题</small></div><div className="selected-tags" id="selectedTags"></div><input id="tagInput" type="text" placeholder="输入话题名称，按回车添加" autoComplete="off" maxLength={60} aria-label="话题名称"/><div className="tag-suggestions" id="tagSuggestions" hidden></div></div><div className="editor-footer"><span id="editorHint">已登录，笔记会同步到你的账号</span><div><button type="button" className="cancel" id="cancelEditor">取消</button><button type="submit" className="save" id="saveNote">保存笔记 <span>↗</span></button></div></div></form></section></div>
    <div className="toast" id="toast" role="status" aria-live="polite"></div>
    <Script src="/app.js" strategy="afterInteractive" />
  </>;
}
