import Script from "next/script";

export default function NotesPage() {
  return <>
    <link rel="stylesheet" href="/styles.css" /><link rel="stylesheet" href="/overrides.css" /><link rel="stylesheet" href="/features.css" />
    <div className="app-shell">
      <div className="mobile-shade" id="mobileShade" hidden></div>
      <aside className="sidebar" id="sidebar">
        <div className="brand"><div><strong>linote</strong><small>保卫个人史</small></div></div>
        <button className="new-button" id="newNoteSidebar" type="button"><span aria-hidden="true">＋</span> 写一条笔记 <kbd>N</kbd></button>
        <button className="calendar-toggle" id="calendarToggle" type="button" aria-expanded="false"><span>▦</span> 每日记录 <small id="todayCount">今日 0 条</small></button>
        <div className="mini-stats" id="calendarPanel" hidden><div className="mini-stats-title"><span>近 35 天</span><strong id="totalStats">共 0 条笔记</strong></div><div className="mini-calendar" id="miniCalendar" aria-label="最近 35 天笔记数量"></div></div>
        <div className="side-section"><button className="nav-item active" id="allNotes" type="button"><span className="nav-icon">▦</span><span>全部笔记</span><span className="nav-count" id="allCount">0</span></button><button className="nav-item" id="reviewNotes" type="button"><span className="nav-icon">↻</span><span>随机回顾</span><span className="nav-count">10</span></button></div>
        <div className="side-section topic-section"><div className="section-heading"><span>话题</span><button type="button" id="sortButton" title="切换话题排序" aria-label="切换话题排序">笔记数 ↓</button></div><div className="topic-list" id="topicList"></div><p className="topic-hint" id="topicHint">添加话题后，会自动出现在这里。</p></div>
        <div className="sidebar-bottom"><span className="account-name" id="accountName">未选择编号</span><button type="button" id="switchAccount">切换编号</button><button type="button" id="exportButton">导出</button></div>
      </aside>
      <main className="main"><header className="topbar"><button className="mobile-menu" type="button" id="mobileMenu" aria-label="打开菜单">☰</button><div className="crumb"><strong id="pageTitle">全部笔记</strong></div><div className="top-actions"><label className="search"><span aria-hidden="true">⌕</span><input id="searchInput" type="search" placeholder="搜索笔记或话题" aria-label="搜索笔记或话题"/><kbd>Ctrl K</kbd></label><button className="top-new" id="newNoteTop" type="button">＋ <span>新笔记</span></button></div></header>
        <div className="content"><div className="feed-heading"><div><strong id="resultCount">0 条笔记</strong><span id="filterLabel">按最近编辑排序</span></div><div className="feed-actions"><button type="button" id="reviewAgain" hidden>换一组 ↻</button><button type="button" id="clearFilter" hidden>清除筛选 ×</button></div></div><section className="notes" id="notes" aria-live="polite"></section><section className="empty" id="empty"><button type="button" id="emptyNew">写一条笔记 <span>↗</span></button></section></div>
      </main>
    </div>
    <div className="modal-layer" id="modalLayer" hidden><div className="modal-backdrop" id="modalBackdrop"></div><section className="editor" role="dialog" aria-modal="true" aria-labelledby="editorTitle"><div className="editor-header"><h2 id="editorTitle">写一条笔记</h2><button type="button" id="closeEditor" aria-label="关闭编辑器">×</button></div><form id="noteForm"><textarea id="noteBody" placeholder="现在的想法是…" maxLength={20000} required></textarea><div className="tag-area"><div className="tag-title"><span>#</span> 添加话题 <small>一条笔记可以有多个话题</small></div><div className="selected-tags" id="selectedTags"></div><input id="tagInput" type="text" placeholder="输入话题名称，按回车添加" autoComplete="off" maxLength={60} aria-label="话题名称"/><div className="tag-suggestions" id="tagSuggestions" hidden></div></div><div className="editor-footer"><span id="editorHint">按笔记编号保存并同步</span><div><button type="button" className="cancel" id="cancelEditor">取消</button><button type="submit" className="save" id="saveNote">保存笔记 <span>↗</span></button></div></div></form></section></div>
    <div className="account-layer" id="accountLayer" hidden><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="accountTitle"><h2 id="accountTitle">选择笔记编号</h2><p>自己填写一个编号，可用中文。同一个编号会显示同一组笔记。</p><form id="accountForm"><label htmlFor="accountInput">笔记编号</label><input id="accountInput" type="text" autoComplete="off" placeholder="例如：小明的笔记" maxLength={64} required/><small id="accountError"></small><button type="submit">进入 linote</button></form><p className="account-warning">编号不是密码。知道编号的人也能查看和修改这组笔记。</p></section></div>
    <div className="toast" id="toast" role="status" aria-live="polite"></div>
    <Script src="/app.js" strategy="afterInteractive" />
  </>;
}
