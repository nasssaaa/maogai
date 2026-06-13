import React, { useState, useEffect, useMemo } from 'react';
import { 
  BookOpen, Star, CheckCircle, XCircle, Shuffle, ArrowLeft, ArrowRight, 
  RefreshCw, Download, Upload, Trash2, Target, BarChart3, Search, Filter, Clock 
} from 'lucide-react';

// Load raw questions and attach stable numeric id (index)
import rawQuestions from './data/questions.json';

const ALL_QUESTIONS = rawQuestions.map((q, idx) => ({
  ...q,
  id: idx,
}));

const TOTAL_QUESTIONS = ALL_QUESTIONS.length;

const CHAPTERS = [1, 2, 3, 4, 5, 6, 7, 8];
const TYPES = ['单选题', '多选题'];

// Only used for persisting the auth token (so you stay logged in after refresh)
const LS_KEYS = {
  TOKEN: 'tiku-auth-token',
};

function normalizeAnswer(str) {
  if (!str) return '';
  return str.toUpperCase().replace(/[^A-F]/g, '').split('').sort().join('');
}

function getOptionLetter(idx) {
  return String.fromCharCode(65 + idx); // A, B, C...
}

// Clean leading "1.[单选题]" / "2.[多选题]" prefixes present in the current bank
function cleanQuestionText(text = '') {
  return text.replace(/^\s*\d+\.\s*\[(单选题|多选题)\]\s*/i, '').trim();
}

// Get effective options + answer: prefer user supplement (override), else fall back to embedded bank data
function getEffectiveForQuestion(q, supplementsMap) {
  const sup = supplementsMap[q.id];
  if (sup && Array.isArray(sup.options) && sup.options.length > 0) {
    return {
      options: sup.options,
      answer: normalizeAnswer(sup.answer || ''),
      source: 'user'
    };
  }
  if (Array.isArray(q.options) && q.options.length > 0) {
    return {
      options: q.options,
      answer: normalizeAnswer(q.answer || ''),
      source: 'bank'
    };
  }
  return { options: [], answer: '', source: 'none' };
}

export default function App() {
  // === Per-user progress data (loaded from / saved to our backend server) ===
  const [supplements, setSupplements] = useState({});
  const [mastered, setMastered] = useState(new Set());
  const [bookmarks, setBookmarks] = useState(new Set());
  const [wrongs, setWrongs] = useState(new Set());

  // Auth
  const [token, setToken] = useState(() => localStorage.getItem(LS_KEYS.TOKEN) || null);
  const [currentUser, setCurrentUser] = useState(null); // username from server
  const [authLoading, setAuthLoading] = useState(true);

  // Login form state
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [loginError, setLoginError] = useState('');

  // Last practice session
  const [lastPractice, setLastPractice] = useState(null);

  // === Exam Mode ===
  const [examState, setExamState] = useState('setup');
  const [examQuestions, setExamQuestions] = useState([]);
  const [examAnswers, setExamAnswers] = useState({});
  const [examTimeLeft, setExamTimeLeft] = useState(30 * 60);
  const [examResult, setExamResult] = useState(null);
  const [examCurrentIdx, setExamCurrentIdx] = useState(0);
  const [examNumSingle, setExamNumSingle] = useState(30);
  const [examNumMulti, setExamNumMulti] = useState(20);

  const [examHistory, setExamHistory] = useState([]);

  // Simple API helper that attaches the JWT
  async function apiFetch(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };
    const res = await fetch(path, { ...options, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `请求失败 (${res.status})`);
    }
    return res.json();
  }

  // Load user data from our backend
  async function loadDataFromServer() {
    try {
      const data = await apiFetch('/api/data');
      setSupplements(data.supplements || {});
      setMastered(new Set(data.mastered || []));
      setBookmarks(new Set(data.bookmarks || []));
      setWrongs(new Set(data.wrongs || []));
      setLastPractice(data.last_practice || null);
      setExamHistory(data.exam_history || []);
    } catch (e) {
      console.error('Failed to load data from server:', e);
      // start with empty on error
      setSupplements({});
      setMastered(new Set());
      setBookmarks(new Set());
      setWrongs(new Set());
      setLastPractice(null);
      setExamHistory([]);
    }
  }

  // Save current progress to server (called after important changes)
  async function saveDataToServer(overrides = {}) {
    if (!token) return;
    try {
      await apiFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({
          supplements: overrides.supplements ?? supplements,
          mastered: Array.from(overrides.mastered ?? mastered),
          bookmarks: Array.from(overrides.bookmarks ?? bookmarks),
          wrongs: Array.from(overrides.wrongs ?? wrongs),
          last_practice: overrides.last_practice ?? lastPractice,
          exam_history: overrides.exam_history ?? examHistory,
        }),
      });
    } catch (e) {
      console.error('Failed to save data to server:', e);
    }
  }

  // Auto-save on changes (debounced)
  useEffect(() => {
    if (!token) return;
    const t = setTimeout(() => {
      saveDataToServer();
    }, 700);
    return () => clearTimeout(t);
  }, [supplements, mastered, bookmarks, wrongs, lastPractice, examHistory, token]);

  // Helper: decode username from JWT (no verification needed on client for display)
  function getUsernameFromToken(t) {
    if (!t) return null;
    try {
      const payload = JSON.parse(atob(t.split('.')[1]));
      return payload.username || null;
    } catch {
      return null;
    }
  }

  // On mount or token change: if we have a token, try to load data
  useEffect(() => {
    let cancelled = false;
    setAuthLoading(true);

    if (token) {
      const uname = getUsernameFromToken(token);
      if (uname) setCurrentUser(uname);
      loadDataFromServer().finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    } else {
      setCurrentUser(null);
      setAuthLoading(false);
    }

    return () => { cancelled = true; };
  }, [token]);

  // === Auth (calls our backend /api/auth/* ) ===
  const handleRegister = async () => {
    const uname = loginUsername.trim();
    if (!uname || !loginPassword) {
      setLoginError('用户名和密码不能为空');
      return;
    }
    if (uname.length < 2) {
      setLoginError('用户名至少 2 个字符');
      return;
    }
    setLoginError('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || '注册失败');
        return;
      }
      localStorage.setItem(LS_KEYS.TOKEN, data.token);
      setToken(data.token);
      setCurrentUser(data.user.username);
      setLoginUsername('');
      setLoginPassword('');
      setIsRegisterMode(false);
    } catch (e) {
      setLoginError('注册失败，请检查网络或服务器是否运行');
    }
  };

  const handleLogin = async () => {
    const uname = loginUsername.trim();
    if (!uname || !loginPassword) {
      setLoginError('用户名和密码不能为空');
      return;
    }
    setLoginError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: uname, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLoginError(data.error || '登录失败');
        return;
      }
      localStorage.setItem(LS_KEYS.TOKEN, data.token);
      setToken(data.token);
      setCurrentUser(data.user.username);
      setLoginUsername('');
      setLoginPassword('');
    } catch (e) {
      setLoginError('登录失败，请检查服务器是否在运行 (npm run dev)');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem(LS_KEYS.TOKEN);
    setToken(null);
    setCurrentUser(null);
    // clear in-memory data
    setSupplements({});
    setMastered(new Set());
    setBookmarks(new Set());
    setWrongs(new Set());
    setLastPractice(null);
    setExamHistory([]);
    setExamState('setup');
    setExamQuestions([]);
    setExamAnswers({});
    setExamResult(null);
  };

  // UI state
  const [activeTab, setActiveTab] = useState('practice'); // practice | browse | wrongs | stats | manage
  const [selectedChapters, setSelectedChapters] = useState([...CHAPTERS]);
  const [selectedTypes, setSelectedTypes] = useState([...TYPES]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark') || 
             window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Practice session
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionIds, setSessionIds] = useState([]); // array of question ids
  const [sessionIdx, setSessionIdx] = useState(0);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [sessionTotal, setSessionTotal] = useState(0);

  // Current question user choice (during session)
  const [currentChoice, setCurrentChoice] = useState([]); // array of letters e.g. ['A','C']
  const [showFeedback, setShowFeedback] = useState(false);
  const [lastResult, setLastResult] = useState(null); // { correct: bool, userAns, realAns }

  // Supplement editor (for current or any)
  const [editingId, setEditingId] = useState(null);
  const [editOptions, setEditOptions] = useState(['', '', '', '']);
  const [editAnswer, setEditAnswer] = useState('');

  // Browse expanded question
  const [expandedId, setExpandedId] = useState(null);

  // Toast / message
  const [toast, setToast] = useState(null);

  // Note: per-user persistence is handled in the login system useEffects above.
  // Old global persistence removed to support multi-user isolation.

  // Dark mode sync
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Keyboard shortcuts (global, only useful in practice)
  useEffect(() => {
    function onKey(e) {
      if (!sessionActive) return;

      const q = getCurrentQuestion();
      if (!q) return;

      if (e.key === 'ArrowLeft') { prevQuestion(); }
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nextQuestion(); }
      if (e.key.toLowerCase() === 'r') { randomNextInSession(); }

      // Choice shortcuts 1-6 or a-f
      const digit = parseInt(e.key, 10);
      if (digit >= 1 && digit <= 6) {
        const letter = getOptionLetter(digit - 1);
        toggleChoice(letter);
      }
      if (/^[a-fA-F]$/.test(e.key)) {
        toggleChoice(e.key.toUpperCase());
      }
      if (e.key === 'Enter' && showFeedback) {
        nextQuestion();
      }
      if (e.key.toLowerCase() === 's' && !showFeedback) {
        submitAnswer();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sessionActive, sessionIdx, currentChoice, showFeedback]);

  // Exam timer
  useEffect(() => {
    if (examState !== 'taking') return;
    const interval = setInterval(() => {
      setExamTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          submitExam(true); // timeout
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [examState]);

  // Filtered questions (used everywhere)
  const filteredQuestions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return ALL_QUESTIONS.filter(q => {
      const chapterOk = selectedChapters.includes(q.chapter);
      const typeOk = selectedTypes.includes(q.type);
      const searchOk = !term || q.question.toLowerCase().includes(term);
      return chapterOk && typeOk && searchOk;
    });
  }, [selectedChapters, selectedTypes, searchTerm]);

  const filteredIds = useMemo(() => filteredQuestions.map(q => q.id), [filteredQuestions]);

  // Stats
  const total = ALL_QUESTIONS.length;
  const masteredCount = mastered.size;
  const supplementCount = Object.keys(supplements).length;
  const bookmarkCount = bookmarks.size;
  const wrongCount = wrongs.size;

  // Per chapter stats
  const chapterStats = useMemo(() => {
    const stats = {};
    CHAPTERS.forEach(ch => {
      const inCh = ALL_QUESTIONS.filter(q => q.chapter === ch);
      const m = inCh.filter(q => mastered.has(q.id)).length;
      stats[ch] = { total: inCh.length, mastered: m, pct: inCh.length ? Math.round(m / inCh.length * 100) : 0 };
    });
    return stats;
  }, [mastered]);

  // Current question in session
  function getCurrentQuestion() {
    if (!sessionActive || sessionIdx >= sessionIds.length) return null;
    const qid = sessionIds[sessionIdx];
    return ALL_QUESTIONS.find(q => q.id === qid) || null;
  }
  const currentQ = getCurrentQuestion();

  const effective = currentQ ? getEffectiveForQuestion(currentQ, supplements) : { options: [], answer: '', source: 'none' };
  const hasOptions = effective.options.length > 0;
  const isUserOverride = effective.source === 'user';

  // Toggle helpers
  function toggleChapter(ch) {
    setSelectedChapters(prev =>
      prev.includes(ch) ? prev.filter(c => c !== ch) : [...prev, ch].sort((a,b)=>a-b)
    );
  }
  function toggleType(t) {
    setSelectedTypes(prev =>
      prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]
    );
  }
  function selectAllChapters() { setSelectedChapters([...CHAPTERS]); }
  function clearChapters() { setSelectedChapters([]); }
  function selectAllTypes() { setSelectedTypes([...TYPES]); }

  // Master / bookmark / wrong toggles
  function toggleMastered(id) {
    setMastered(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleBookmark(id) {
    setBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function addToWrongs(id) {
    setWrongs(prev => new Set(prev).add(id));
  }
  function removeFromWrongs(id) {
    setWrongs(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  // Supplement save / delete
  function saveSupplement(id, optionsArr, ans) {
    const cleanOpts = optionsArr.map(o => (o || '').trim()).filter(Boolean);
    const normAns = normalizeAnswer(ans);
    if (!normAns) {
      showToast('请填写正确答案（例如 A 或 AC）', 'error');
      return false;
    }
    setSupplements(prev => ({
      ...prev,
      [id]: { options: cleanOpts.length ? cleanOpts : ['（选项待补充）', '（选项待补充）', '（选项待补充）', '（选项待补充）'], answer: normAns }
    }));
    setEditingId(null);
    setEditOptions(['', '', '', '']);
    setEditAnswer('');
    showToast('答案已保存，可用于自动批改', 'success');
    return true;
  }
  function deleteSupplement(id) {
    setSupplements(prev => {
      const { [id]: _, ...rest } = prev;
      return rest;
    });
    showToast('已删除该题补充答案');
  }

  function openEditorFor(id) {
    const sup = supplements[id];
    if (sup) {
      setEditOptions([...sup.options, '', '', '', ''].slice(0, 6)); // allow up to 6
      setEditAnswer(sup.answer);
    } else {
      setEditOptions(['', '', '', '']);
      setEditAnswer('');
    }
    setEditingId(id);
    // If in browse, also expand it
    if (activeTab === 'browse') setExpandedId(id);
  }

  function closeEditor() {
    setEditingId(null);
    setEditOptions(['', '', '', '']);
    setEditAnswer('');
  }

  // Session control
  function startSession(useRandom = false, resumeFromLast = false) {
    let ids = [];
    let startIdx = 0;

    if (resumeFromLast && lastPractice && lastPractice.ids && lastPractice.ids.length > 0) {
      ids = [...lastPractice.ids];
      startIdx = Math.min(lastPractice.idx || 0, ids.length - 1);
    } else {
      if (filteredIds.length === 0) {
        showToast('没有符合条件的题目', 'error');
        return;
      }
      ids = [...filteredIds];
      if (useRandom) {
        ids.sort(() => Math.random() - 0.5);
      }
      startIdx = 0;
    }

    setSessionIds(ids);
    setSessionIdx(startIdx);
    setSessionCorrect(0);
    setSessionTotal(0);
    setSessionActive(true);
    resetCurrentChoiceAndFeedback();
    setActiveTab('practice');
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // Save / update last practice state
    updateLastPractice(ids, startIdx);
  }

  // === Exam Helpers ===
  function startExam() {
    const pool = filteredQuestions;
    const singlesPool = pool.filter(q => q.type === '单选题');
    const multisPool = pool.filter(q => q.type === '多选题');

    const takeSingle = Math.min(examNumSingle, singlesPool.length);
    const takeMulti = Math.min(examNumMulti, multisPool.length);

    if (takeSingle + takeMulti === 0) {
      showToast('当前筛选下没有足够题目', 'error');
      return;
    }

    // Shuffle pools
    const shuffledSingles = [...singlesPool].sort(() => Math.random() - 0.5);
    const shuffledMultis = [...multisPool].sort(() => Math.random() - 0.5);

    const selected = [
      ...shuffledSingles.slice(0, takeSingle),
      ...shuffledMultis.slice(0, takeMulti)
    ].sort(() => Math.random() - 0.5);

    setExamQuestions(selected);
    setExamAnswers({});
    setExamTimeLeft(30 * 60);
    setExamCurrentIdx(0);
    setExamResult(null);
    setExamState('taking');
    setActiveTab('exam');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function submitExam(isTimeout = false) {
    if (examQuestions.length === 0) return;

    const resultBase = computeExamResult(examQuestions, examAnswers, isTimeout) || {};
    const result = {
      ...resultBase,
      timeUsed: 30 * 60 - examTimeLeft,
      isTimeout
    };

    setExamResult(result);
    setExamState('results');

    // Auto add wrongs to the user's wrong book
    const newWrongs = new Set(wrongs);
    (result.details || []).forEach(d => {
      if (!d.isCorrect) newWrongs.add(d.q.id);
    });
    setWrongs(newWrongs);

    // Save to per-user exam history (store minimal for replay + scalars)
    const historyRecord = {
      id: Date.now(),
      timestamp: Date.now(),
      date: new Date().toLocaleString('zh-CN'),
      score: result.score,
      correct: result.correct,
      total: result.total,
      single: result.single,
      multi: result.multi,
      timeUsed: result.timeUsed,
      isTimeout: !!result.isTimeout,
      questionIds: examQuestions.map(q => q.id),
      userAnswers: { ...examAnswers }
    };
    setExamHistory(prev => [historyRecord, ...(prev || [])].slice(0, 100)); // keep last 100

    // Explicit immediate save for exam result
    saveDataToServer({ exam_history: [historyRecord, ...(examHistory || [])].slice(0, 100) });

    if (isTimeout) {
      showToast('时间到，考试自动提交');
    } else {
      showToast('考试提交成功');
    }
  }

  function exitExam() {
    setExamState('setup');
    setExamQuestions([]);
    setExamAnswers({});
    setExamResult(null);
    setExamCurrentIdx(0);
    setExamTimeLeft(30 * 60);
  }

  // Pure scorer for both live submit and history replay
  function computeExamResult(questions, answersMap, isTimeout = false) {
    if (!questions || questions.length === 0) return null;

    let correctCount = 0;
    const details = questions.map(q => {
      const userRaw = answersMap[q.id];
      const userNorm = q.type === '单选题'
        ? normalizeAnswer(typeof userRaw === 'string' ? userRaw : '')
        : normalizeAnswer(Array.isArray(userRaw) ? userRaw.join('') : '');

      const correctNorm = normalizeAnswer(q.answer || '');
      const isCorrect = userNorm === correctNorm && userNorm !== '';

      if (isCorrect) correctCount++;

      return {
        q,
        userAnswer: userRaw,
        userNorm,
        correctNorm,
        isCorrect
      };
    });

    const total = questions.length;
    const score = Math.round((correctCount / total) * 100);

    const singleQs = questions.filter(q => q.type === '单选题');
    const multiQs = questions.filter(q => q.type === '多选题');

    const singleCorrect = details.filter(d => d.q.type === '单选题' && d.isCorrect).length;
    const multiCorrect = details.filter(d => d.q.type === '多选题' && d.isCorrect).length;

    return {
      score,
      correct: correctCount,
      total,
      single: { correct: singleCorrect, total: singleQs.length },
      multi: { correct: multiCorrect, total: multiQs.length },
      details,
      timeUsed: 0,
      isTimeout
    };
  }

  function goToExamQuestion(idx) {
    if (idx >= 0 && idx < examQuestions.length) {
      setExamCurrentIdx(idx);
    }
  }

  // === Exam History helpers ===
  function viewHistoryRecord(record) {
    if (!record || !Array.isArray(record.questionIds) || record.questionIds.length === 0) {
      showToast('历史记录无效', 'error');
      return;
    }
    // Rebuild questions from canonical bank (robust, no bloat in storage)
    const qs = record.questionIds
      .map(id => ALL_QUESTIONS.find(q => q.id === id))
      .filter(Boolean);

    if (qs.length === 0) {
      showToast('题库中已无这些题目', 'error');
      return;
    }

    const answers = record.userAnswers || {};

    // Recompute full result + details for rich 答题卡
    const recomputed = computeExamResult(qs, answers, !!record.isTimeout) || {};
    const fullResult = {
      ...recomputed,
      timeUsed: record.timeUsed || recomputed.timeUsed || 0,
      isTimeout: !!record.isTimeout,
      // keep original scalars if present
      score: record.score ?? recomputed.score,
      correct: record.correct ?? recomputed.correct,
      total: record.total ?? recomputed.total,
      single: record.single || recomputed.single,
      multi: record.multi || recomputed.multi,
    };

    setExamQuestions(qs);
    setExamAnswers(answers);
    setExamResult(fullResult);
    setExamCurrentIdx(0);
    setExamTimeLeft(30 * 60);
    setExamState('results');
    setActiveTab('exam');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    showToast('已加载历史考试记录（只读）');
  }

  function deleteHistoryRecord(id) {
    setExamHistory(prev => (prev || []).filter(r => r.id !== id));
    showToast('已删除该条历史记录');
  }

  function clearExamHistory() {
    if (!confirm('确定清空所有历史考试记录？')) return;
    setExamHistory([]);
    showToast('历史考试记录已清空');
  }

  // Start a fresh taking session using the exact questions from a history record (re-exam same set)
  function retakeFromHistory(record) {
    if (!record || !Array.isArray(record.questionIds) || record.questionIds.length === 0) return;
    const qs = record.questionIds
      .map(id => ALL_QUESTIONS.find(q => q.id === id))
      .filter(Boolean);
    if (qs.length === 0) {
      showToast('题库中已无这些题目', 'error');
      return;
    }
    setExamQuestions(qs);
    setExamAnswers({});
    setExamTimeLeft(30 * 60);
    setExamCurrentIdx(0);
    setExamResult(null);
    setExamState('taking');
    setActiveTab('exam');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startWrongOrBookmarkedSession() {
    const ids = [...new Set([...wrongs, ...bookmarks])];
    if (ids.length === 0) {
      showToast('错题本和收藏夹都为空', 'error');
      return;
    }
    // Only use ones still existing
    const valid = ids.filter(id => ALL_QUESTIONS.some(q => q.id === id));
    if (!valid.length) return;
    setSessionIds(valid.sort(() => Math.random() - 0.5));
    setSessionIdx(0);
    setSessionCorrect(0);
    setSessionTotal(0);
    setSessionActive(true);
    resetCurrentChoiceAndFeedback();
    setActiveTab('practice');
  }

  function endSession() {
    setSessionActive(false);
    setSessionIds([]);
    setSessionIdx(0);
    setSessionCorrect(0);
    setSessionTotal(0);
    resetCurrentChoiceAndFeedback();
    // Optionally keep lastPractice for "review last session", or clear:
    // clearLastPractice(); // comment out if you want to keep the last position
  }

  function updateLastPractice(ids, idx) {
    if (!currentUser || !ids || ids.length === 0) return;
    setLastPractice({ ids: [...ids], idx: idx || 0, timestamp: Date.now() });
  }

  function clearLastPractice() {
    setLastPractice(null);
    if (currentUser) {
      const prefix = `tiku-${currentUser}-`;
      localStorage.removeItem(prefix + 'last-practice-ids');
      localStorage.removeItem(prefix + 'last-practice-idx');
    }
  }

  function resetCurrentChoiceAndFeedback() {
    setCurrentChoice([]);
    setShowFeedback(false);
    setLastResult(null);
  }

  function prevQuestion() {
    if (sessionIdx > 0) {
      const newIdx = sessionIdx - 1;
      setSessionIdx(newIdx);
      updateLastPractice(sessionIds, newIdx);
      resetCurrentChoiceAndFeedback();
    }
  }

  function nextQuestion() {
    if (sessionIdx < sessionIds.length - 1) {
      const newIdx = sessionIdx + 1;
      setSessionIdx(newIdx);
      updateLastPractice(sessionIds, newIdx);
      resetCurrentChoiceAndFeedback();
    } else {
      // End of session
      showToast(`练习结束！本次正确率 ${sessionTotal ? Math.round(sessionCorrect / sessionTotal * 100) : 0}%`);
      clearLastPractice(); // finished this practice run
      endSession();
    }
  }

  function randomNextInSession() {
    if (sessionIds.length <= 1) return;
    let next = Math.floor(Math.random() * sessionIds.length);
    // try avoid same
    if (next === sessionIdx && sessionIds.length > 1) next = (next + 1) % sessionIds.length;
    setSessionIdx(next);
    updateLastPractice(sessionIds, next);
    resetCurrentChoiceAndFeedback();
  }

  // Choice selection
  function toggleChoice(letter) {
    if (showFeedback) return; // locked after submit
    const q = currentQ;
    if (!q) return;

    const isMulti = q.type === '多选题';

    setCurrentChoice(prev => {
      if (isMulti) {
        if (prev.includes(letter)) return prev.filter(l => l !== letter);
        return [...prev, letter].sort();
      } else {
        return prev.includes(letter) ? [] : [letter];
      }
    });
  }

  function submitAnswer() {
    const q = currentQ;
    if (!q || currentChoice.length === 0) {
      showToast('请先选择答案', 'error');
      return;
    }

    const userAns = normalizeAnswer(currentChoice.join(''));
    const eff = getEffectiveForQuestion(q, supplements);

    const real = eff.answer;                // already normalized
    const isCorrect = !!real && (userAns === real);

    setShowFeedback(true);
    setLastResult({ correct: isCorrect, userAns, real });

    setSessionTotal(prev => prev + 1);
    if (isCorrect) {
      setSessionCorrect(prev => prev + 1);
      markMastered(q.id); // 答对后自动标记掌握，进度会保存
    } else if (real) {
      unmarkMastered(q.id);
      addToWrongs(q.id);
    }
  }

  // Self report (when no supplement yet)
  function markMastered(id) {
    if (id == null) return; // allow id=0 (first question in array)
    setMastered(prev => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function unmarkMastered(id) {
    if (id == null) return;
    setMastered(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function selfReport(correct) {
    const q = currentQ;
    if (!q) return;

    setShowFeedback(true);
    setLastResult({ correct, userAns: normalizeAnswer(currentChoice.join('')), real: '' });

    setSessionTotal(prev => prev + 1);
    if (correct) {
      setSessionCorrect(prev => prev + 1);
      markMastered(q.id); // 正确自评后自动标记为已掌握，保存进度
    } else {
      unmarkMastered(q.id);
      addToWrongs(q.id);
    }
  }

  // Quick practice a single random from filter (no full session)
  function practiceOneRandom() {
    if (!filteredIds.length) return;
    const randomId = filteredIds[Math.floor(Math.random() * filteredIds.length)];
    setSessionIds([randomId]);
    setSessionIdx(0);
    setSessionCorrect(0);
    setSessionTotal(0);
    setSessionActive(true);
    resetCurrentChoiceAndFeedback();
    setActiveTab('practice');
  }

  // Render helpers
  function renderQuestionText(text) {
    // Split on Chinese fullwidth parens blanks
    const parts = text.split(/(（\s*　*\s*）|\(\s*　*\s*\))/g);
    return parts.map((part, i) => {
      if (/^（\s*　*\s*）$|^\(\s*　*\s*\)$/.test(part)) {
        return <span key={i} className="blank">____</span>;
      }
      return <span key={i}>{part}</span>;
    });
  }

  function renderOptions(q, eff, choiceArr, showFb, result) {
    const opts = eff?.options?.length ? eff.options : ['A', 'B', 'C', 'D'];
    const letters = opts.map((_, i) => getOptionLetter(i));
    const isMulti = q.type === '多选题';

    return (
      <div className="space-y-2 mt-5">
        {opts.map((optText, i) => {
          const L = letters[i];
          // Strip leading "A." / "B、" etc. if the bank already includes the letter in the option text
          const displayText = (optText || '（待补充）').replace(/^[A-Fa-f][.、．]\s*/, '');
          const selected = choiceArr.includes(L);
          let cls = 'opt-btn';
          if (showFb && eff && eff.answer) {
            const isRight = normalizeAnswer(eff.answer).includes(L);
            if (isRight) cls += ' correct';
            else if (selected) cls += ' wrong';
          } else if (selected) {
            cls += ' selected';
          }
          return (
            <button
              key={i}
              onClick={() => toggleChoice(L)}
              disabled={showFb && eff && eff.answer}
              className={cls}
            >
              <div className="font-semibold w-6 shrink-0 text-amber-400">{L}.</div>
              <div className="text-slate-700 dark:text-slate-200">{displayText}</div>
            </button>
          );
        })}
      </div>
    );
  }

  function showToast(msg, type = 'info') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2200);
  }

  // Export / Import supplements
  function exportSupplements() {
    const blob = new Blob([JSON.stringify(supplements, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tiku-supplements.json';
    a.click();
    URL.revokeObjectURL(url);
    showToast('已导出补充答案，可备份或分享');
  }

  function importSupplements(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const imported = JSON.parse(ev.target.result);
        if (typeof imported !== 'object') throw new Error();
        // Merge
        setSupplements(prev => ({ ...prev, ...imported }));
        showToast('答案导入成功（已合并）');
      } catch {
        showToast('导入失败：文件格式不正确', 'error');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function resetAllUserData() {
    if (!currentUser || !token) return;
    if (!confirm(`确定要清空用户 "${currentUser}" 的所有进度吗？此操作不可恢复。`)) return;

    try {
      await apiFetch('/api/data', {
        method: 'POST',
        body: JSON.stringify({
          supplements: {},
          mastered: [],
          bookmarks: [],
          wrongs: [],
          last_practice: null,
          exam_history: [],
        }),
      });
    } catch (e) {
      // ignore, we'll clear local anyway
    }

    // Clear local state
    setSupplements({});
    setMastered(new Set());
    setBookmarks(new Set());
    setWrongs(new Set());
    setLastPractice(null);
    setExamHistory([]);
    endSession();
    showToast(`用户 "${currentUser}" 的进度已重置（已同步到服务器）`);
  }

  // === RENDER ===

  const progressPct = sessionIds.length ? Math.round(((sessionIdx + (showFeedback ? 1 : 0)) / sessionIds.length) * 100) : 0;
  const sessionRate = sessionTotal ? Math.round((sessionCorrect / sessionTotal) * 100) : 0;

  // === Login Screen (if not logged in) ===
  if (!currentUser) {
    if (authLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950">
          <div className="text-slate-400">正在连接服务器...</div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 dark:bg-slate-950 p-4">
        <div className="w-full max-w-md">
          <div className="card p-8">
            <div className="flex items-center gap-3 mb-6 justify-center">
              <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center text-black">
                <BookOpen size={22} />
              </div>
              <div>
                <div className="font-semibold text-2xl tracking-tight">刷题宝</div>
                <div className="text-xs text-slate-500 -mt-1">毛概题库 · 服务器同步版</div>
              </div>
            </div>

            <div className="flex gap-2 mb-6">
              <button 
                onClick={() => { setIsRegisterMode(false); setLoginError(''); }}
                className={`flex-1 py-2 rounded-xl text-sm font-medium ${!isRegisterMode ? 'bg-amber-500 text-black' : 'border border-zinc-700'}`}
              >
                登录
              </button>
              <button 
                onClick={() => { setIsRegisterMode(true); setLoginError(''); }}
                className={`flex-1 py-2 rounded-xl text-sm font-medium ${isRegisterMode ? 'bg-amber-500 text-black' : 'border border-zinc-700'}`}
              >
                注册新用户
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 block mb-1">用户名</label>
                <input 
                  value={loginUsername} 
                  onChange={e => setLoginUsername(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border bg-white dark:bg-slate-900"
                  placeholder="输入用户名（不同设备通用）"
                  onKeyDown={e => e.key === 'Enter' && (isRegisterMode ? handleRegister() : handleLogin())}
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 block mb-1">密码</label>
                <input 
                  type="password" 
                  value={loginPassword} 
                  onChange={e => setLoginPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border bg-white dark:bg-slate-900"
                  placeholder="输入密码"
                  onKeyDown={e => e.key === 'Enter' && (isRegisterMode ? handleRegister() : handleLogin())}
                />
              </div>

              {loginError && <div className="text-red-500 text-sm">{loginError}</div>}

              <button 
                onClick={isRegisterMode ? handleRegister : handleLogin}
                className="w-full py-3 mt-2 rounded-2xl bg-amber-500 hover:bg-amber-600 text-black font-medium"
              >
                {isRegisterMode ? '注册并登录' : '登录'}
              </button>
            </div>

            <div className="mt-6 text-center text-xs text-slate-500 leading-relaxed">
              数据存储在服务器（SQLite），支持多设备 / 不同终端同步。<br />
              同一用户名在手机和电脑上登录后进度完全一致。
            </div>

            <div className="mt-4 text-center text-[10px] text-slate-500">
              开发时请确保后端已启动（npm run dev 会同时启动前后端）
            </div>
          </div>
        </div>
      </div>
    );
  }

  // === Main App (logged in) ===
  return (
    <div className="app-container text-slate-800 dark:text-slate-200">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-black/95 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center text-black">
              <BookOpen size={20} />
            </div>
            <div>
              <div className="font-semibold text-xl tracking-tight">刷题宝</div>
              <div className="text-[10px] text-slate-500 -mt-1">毛概题库 · {TOTAL_QUESTIONS}题</div>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm ml-auto">
            <div className="flex items-center gap-2 px-3 py-1 bg-white dark:bg-slate-800 border rounded-xl text-sm">
              <span className="text-slate-500">当前用户：</span>
              <strong className="text-amber-400">{currentUser}</strong>
            </div>
            <button
              onClick={handleLogout}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-sm"
            >
              登出
            </button>
            <button
              onClick={() => setIsDark(!isDark)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              {isDark ? '浅色' : '深色'}
            </button>
            <button
              onClick={resetAllUserData}
              className="flex items-center gap-1 px-3 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-lg text-sm"
            >
              <Trash2 size={15} /> 重置当前用户
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="max-w-6xl mx-auto px-4 md:px-6 border-t border-zinc-800 flex gap-1 overflow-x-auto">
          {[
            { key: 'practice', label: '练习模式', icon: Target },
            { key: 'exam', label: '考试模式', icon: Clock },
            { key: 'browse', label: '浏览题库', icon: BookOpen },
            { key: 'wrongs', label: `错题本 (${wrongCount + bookmarkCount})`, icon: XCircle },
            { key: 'stats', label: '数据统计', icon: BarChart3 },
            { key: 'manage', label: '答案管理', icon: Upload },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => { setActiveTab(t.key); if (t.key !== 'practice') endSession(); }}
              className={`tab flex items-center gap-2 whitespace-nowrap ${activeTab === t.key ? 'active' : ''}`}
            >
              <t.icon size={16} /> {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">
        {/* Global filters (visible in practice + browse + exam so user can tune the pool for exam) */}
        {(activeTab === 'practice' || activeTab === 'browse' || activeTab === 'exam') && (
          <div className="card p-4 mb-5">
            <div className="flex items-center gap-2 mb-3 text-sm font-medium text-zinc-400">
              <Filter size={16} /> 筛选题库
            </div>

            {/* Chapters */}
            <div className="flex flex-wrap gap-2 mb-3">
              {CHAPTERS.map(ch => (
                <button
                  key={ch}
                  onClick={() => toggleChapter(ch)}
                  className={`chip ${selectedChapters.includes(ch) ? 'active' : ''}`}
                >
                  第{ch}章
                </button>
              ))}
              <button onClick={selectAllChapters} className="text-xs px-2.5 text-amber-400 hover:underline">全选</button>
              <button onClick={clearChapters} className="text-xs px-2.5 text-zinc-400 hover:underline">清空</button>
            </div>

            {/* Types + Search */}
            <div className="flex flex-wrap items-center gap-2">
              {TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={`chip ${selectedTypes.includes(t) ? 'active' : ''}`}
                >
                  {t}
                </button>
              ))}
              <button onClick={selectAllTypes} className="text-xs px-2.5 text-amber-400 hover:underline">全选类型</button>

              <div className="flex-1 min-w-[220px] relative ml-auto">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="搜索题干关键词..."
                  className="w-full pl-9 pr-4 py-2 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm"
                />
                <Search className="absolute left-3 top-2.5 text-slate-400" size={17} />
              </div>
              <div className="text-xs text-slate-500 ml-2">{filteredQuestions.length} 题</div>
            </div>
          </div>
        )}



        {/* Tab-specific content */}
        {activeTab === 'practice' && (
          <>
            {!sessionActive && (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="card p-6">
                  <div className="font-semibold mb-2 flex items-center gap-2"><Target size={18}/> 开始练习</div>
                  <div className="text-sm text-slate-500 mb-4">
                    当前筛选 <span className="font-semibold text-blue-600">{filteredQuestions.length}</span> 道题
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <button onClick={() => startSession(false)} className="flex-1 min-w-[140px] py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-medium flex items-center justify-center gap-2">
                      <ArrowRight size={18}/> 顺序练习
                    </button>
                    <button onClick={() => startSession(true)} className="flex-1 min-w-[140px] py-3 rounded-2xl bg-slate-900 hover:bg-black text-white font-medium flex items-center justify-center gap-2 dark:bg-white dark:text-slate-900">
                      <Shuffle size={18}/> 随机练习
                    </button>
                    <button onClick={practiceOneRandom} className="flex-1 min-w-[140px] py-3 rounded-2xl border border-blue-600 text-blue-600 hover:bg-blue-50 font-medium flex items-center justify-center gap-2">
                      <Shuffle size={16}/> 随机一题
                    </button>
                  </div>

                  {/* Continue previous progress */}
                  {lastPractice && lastPractice.ids && lastPractice.ids.length > 0 && (
                    <button
                      onClick={() => startSession(false, true)}
                      className="mt-3 w-full py-2.5 rounded-2xl border border-amber-500 text-amber-400 hover:bg-amber-950/30 font-medium flex items-center justify-center gap-2"
                    >
                      <ArrowRight size={18} /> 继续上次练习（第 {(lastPractice.idx || 0) + 1} / {lastPractice.ids.length} 题）
                    </button>
                  )}
                  <div className="text-[12px] text-slate-500 mt-4 leading-relaxed">
                    提示：按 <span className="font-mono bg-slate-100 dark:bg-slate-800 px-1 rounded">1-4</span> 快速选 A-D，方向键翻题，<span className="font-mono">R</span> 随机下一题。
                    练习中答对的题目会自动标记为「已掌握」，进度会保存，下次打开仍能看到你做到哪里。
                  </div>
                </div>

                <div className="card p-6">
                  <div className="font-semibold mb-2">我的进度</div>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <div className="text-3xl font-semibold tabular-nums">{masteredCount}</div>
                      <div className="text-xs text-slate-500">已掌握</div>
                    </div>
                    <div>
                      <div className="text-3xl font-semibold tabular-nums">{supplementCount}</div>
                      <div className="text-xs text-slate-500">已补充答案</div>
                    </div>
                    <div>
                      <div className="text-3xl font-semibold tabular-nums">{wrongCount}</div>
                      <div className="text-xs text-slate-500">错题</div>
                    </div>
                  </div>
                  <button onClick={startWrongOrBookmarkedSession} disabled={wrongCount + bookmarkCount === 0} className="mt-5 w-full py-2.5 border rounded-2xl disabled:opacity-50 flex justify-center items-center gap-2">
                    <RefreshCw size={16}/> 重新练习错题 / 收藏题
                  </button>
                </div>
              </div>
            )}

            {sessionActive && currentQ && (
              <div className="session-card">
                <div className="flex justify-between items-center mb-2 text-sm">
                  <div className="font-mono text-slate-500">
                    {sessionIdx + 1} / {sessionIds.length} <span className="ml-2 text-emerald-600">已掌握 {mastered.size}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {sessionTotal > 0 && (
                      <span className="text-emerald-600 font-medium tabular-nums">正确率 {sessionRate}%</span>
                    )}
                    <button onClick={endSession} className="text-xs px-3 py-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded">结束练习</button>
                  </div>
                </div>
                <div className="progress-bar mb-6"><div className="progress-fill" style={{ width: `${progressPct}%` }} /></div>

                {/* Meta */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <span className="q-meta">第{currentQ.chapter}章 · 第{currentQ.number}题</span>
                  <span className={`q-meta ${currentQ.type === '多选题' ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/50' : ''}`}>{currentQ.type}</span>

                  <button onClick={() => toggleBookmark(currentQ.id)} className="ml-auto flex items-center gap-1 text-sm px-3 py-1 rounded-full border hover:bg-slate-50 dark:hover:bg-slate-800">
                    <Star size={15} className={bookmarks.has(currentQ.id) ? 'fill-yellow-400 text-yellow-400' : ''} /> {bookmarks.has(currentQ.id) ? '已收藏' : '收藏'}
                  </button>
                  <button onClick={() => toggleMastered(currentQ.id)} className="flex items-center gap-1 text-sm px-3 py-1 rounded-full border hover:bg-slate-50 dark:hover:bg-slate-800">
                    <CheckCircle size={15} className={mastered.has(currentQ.id) ? 'text-emerald-600' : ''} /> {mastered.has(currentQ.id) ? '已掌握' : '掌握'}
                  </button>
                </div>

                {/* Question */}
                <div className="question-text mb-1">
                  {renderQuestionText(cleanQuestionText(currentQ.question))}
                </div>

                {/* Options / Answer area */}
                {hasOptions ? (
                  <>
                    {renderOptions(currentQ, effective, currentChoice, showFeedback, lastResult)}

                    {!showFeedback && (
                      <button onClick={submitAnswer} className="mt-5 w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-medium">确认答案 (S / Enter)</button>
                    )}

                    {showFeedback && lastResult && (
                      <div className={`mt-5 p-4 rounded-2xl text-sm ${lastResult.correct ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'}`}>
                        {lastResult.correct ? '回答正确！' : '回答错误'}
                        {lastResult.correct && <span className="ml-2 text-xs opacity-75">（已自动标记为掌握，进度已保存）</span>}
                        {effective.answer && <span className="ml-2 font-mono">正确答案：{effective.answer}</span>}
                        {isUserOverride && <span className="ml-2 text-xs opacity-60">(用户覆盖)</span>}
                        <div className="mt-3">
                          <button onClick={nextQuestion} className="px-5 py-2 bg-white dark:bg-slate-800 border rounded-xl">下一题 →</button>
                        </div>
                      </div>
                    )}

                    <button onClick={() => openEditorFor(currentQ.id)} className="mt-3 text-xs text-blue-600 hover:underline">
                      编辑/覆盖本题答案
                    </button>
                  </>
                ) : (
                  <>
                    <div className="mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-sm">
                      本题题库中暂无选项/答案。请选择后自评，或补充标准答案。
                    </div>

                    {/* Choice simulator */}
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {['A', 'B', 'C', 'D'].map((L, i) => (
                        <button key={i} onClick={() => toggleChoice(L)} disabled={showFeedback}
                          className={`py-3 rounded-2xl border text-lg font-medium transition ${currentChoice.includes(L) ? 'bg-blue-600 text-white border-blue-600' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                          {L}
                        </button>
                      ))}
                    </div>

                    {!showFeedback && currentChoice.length > 0 && (
                      <div className="mt-5 grid grid-cols-2 gap-3">
                        <button onClick={() => selfReport(true)} className="py-3 rounded-2xl bg-emerald-600 text-white flex justify-center gap-2 items-center">
                          <CheckCircle size={18} /> 我答对了
                        </button>
                        <button onClick={() => selfReport(false)} className="py-3 rounded-2xl bg-red-600 text-white flex justify-center gap-2 items-center">
                          <XCircle size={18} /> 我答错了
                        </button>
                      </div>
                    )}

                    {showFeedback && (
                      <div className="mt-4">
                        {lastResult && lastResult.correct && (
                          <div className="mb-2 text-xs text-emerald-600">已自动标记为掌握，进度已保存</div>
                        )}
                        <button onClick={nextQuestion} className="w-full py-3 rounded-2xl border font-medium">下一题</button>
                      </div>
                    )}

                    <button onClick={() => openEditorFor(currentQ.id)} className="mt-4 text-sm text-blue-600 hover:underline flex items-center gap-1">
                      + 补充这道题的标准选项和答案
                    </button>
                  </>
                )}

                {/* Session toolbar */}
                <div className="flex justify-between mt-8 pt-5 border-t border-slate-100 dark:border-slate-800 text-sm">
                  <button onClick={prevQuestion} disabled={sessionIdx === 0} className="flex items-center gap-1 disabled:opacity-40"><ArrowLeft size={16} /> 上一题</button>
                  <div className="flex gap-4">
                    <button onClick={randomNextInSession} className="flex items-center gap-1"><Shuffle size={15} /> 随机跳题</button>
                    <button onClick={nextQuestion} className="flex items-center gap-1">下一题 <ArrowRight size={16} /></button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'exam' && (
          <div className="max-w-3xl mx-auto">
            {examState === 'setup' && (
              <div className="card p-6">
                <div className="font-semibold mb-1 flex items-center gap-2 text-lg"><Clock size={20} /> 考试模式</div>
                <div className="text-sm text-slate-500 mb-4">根据当前筛选的题库出题（默认 30 单选 + 20 多选，30分钟）</div>

                <div className="mb-4 p-4 bg-zinc-950 rounded-xl border border-zinc-700">
                  <div className="text-sm text-zinc-400 mb-2">基于当前筛选的题库</div>
                  <div className="flex gap-6">
                    <div>单选可用: <span className="font-semibold text-amber-400">{filteredQuestions.filter(q => q.type === '单选题').length}</span></div>
                    <div>多选可用: <span className="font-semibold text-amber-400">{filteredQuestions.filter(q => q.type === '多选题').length}</span></div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm mb-1">单选题数量 (默认30)</label>
                    <input 
                      type="number" 
                      value={examNumSingle} 
                      onChange={e => setExamNumSingle(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-4 py-3 rounded-xl border border-zinc-700 bg-zinc-900"
                      min="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm mb-1">多选题数量 (默认20)</label>
                    <input 
                      type="number" 
                      value={examNumMulti} 
                      onChange={e => setExamNumMulti(Math.max(0, parseInt(e.target.value) || 0))}
                      className="w-full px-4 py-3 rounded-xl border border-zinc-700 bg-zinc-900"
                      min="0"
                    />
                  </div>
                </div>

                <div className="text-center mb-4 text-sm text-zinc-400">
                  总题数: <span className="text-amber-400 font-semibold">{examNumSingle + examNumMulti}</span> 题 &nbsp;·&nbsp; 时间: <span className="text-amber-400 font-semibold">30 分钟</span>
                </div>

                <button 
                  onClick={startExam} 
                  disabled={examNumSingle + examNumMulti === 0}
                  className="w-full py-4 rounded-2xl bg-amber-500 hover:bg-amber-600 text-black font-semibold text-lg disabled:opacity-50"
                >
                  开始考试
                </button>

                <div className="mt-4 text-xs text-center text-zinc-500">
                  考试中题目随机排序 · 提交后可查看详细对错 · 错题自动加入错题本
                </div>
              </div>
            )}

            {/* 历史考试记录（仅在 setup 时显示） */}
            {examState === 'setup' && (
              <div className="card p-5 mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-semibold flex items-center gap-2"><Clock size={18}/> 历史考试记录</div>
                  {examHistory.length > 0 && (
                    <button onClick={clearExamHistory} className="text-xs px-3 py-1 border border-red-600 text-red-400 rounded hover:bg-red-950/30">清空全部</button>
                  )}
                </div>

                {examHistory.length === 0 ? (
                  <div className="text-sm text-zinc-400 py-4 text-center">还没有考试记录。完成一次考试后会自动保存。</div>
                ) : (
                  <div className="space-y-2 max-h-[420px] overflow-auto pr-1">
                    {examHistory.map((rec, i) => (
                      <div key={rec.id} className="flex flex-col md:flex-row md:items-center gap-2 border border-zinc-700 rounded-xl p-3 bg-zinc-950/60">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-baseline gap-2">
                            <span className="font-mono text-lg text-amber-400 font-semibold tabular-nums">{rec.score}</span>
                            <span className="text-xs text-zinc-400">分</span>
                            <span className="text-sm ml-2 text-emerald-400">{rec.correct}/{rec.total} 正确</span>
                          </div>
                          <div className="text-xs text-zinc-400 mt-0.5">
                            {rec.date} · 用时 {Math.floor((rec.timeUsed||0)/60)}分{(rec.timeUsed||0)%60}秒
                            {rec.isTimeout && <span className="ml-1 text-red-400">(超时)</span>}
                            <span className="ml-2">单选 {rec.single?.correct}/{rec.single?.total} · 多选 {rec.multi?.correct}/{rec.multi?.total}</span>
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => viewHistoryRecord(rec)}
                            className="px-3 py-1.5 text-sm rounded-lg border border-amber-500 text-amber-400 hover:bg-amber-950/30"
                          >
                            查看记录
                          </button>
                          <button
                            onClick={() => retakeFromHistory(rec)}
                            className="px-3 py-1.5 text-sm rounded-lg bg-amber-500 text-black font-medium hover:bg-amber-600"
                          >
                            再考一次
                          </button>
                          <button
                            onClick={() => deleteHistoryRecord(rec.id)}
                            className="px-2 py-1.5 text-sm border border-red-600 text-red-400 rounded-lg hover:bg-red-950/30"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-[11px] text-zinc-500">最多保留最近 100 条 · 点击「查看记录」可完整回放答题卡</div>
              </div>
            )}

            {examState === 'taking' && examQuestions.length > 0 && (
              <div className="session-card">
                <div className="flex justify-between items-center mb-4">
                  <div className={`text-2xl font-mono font-semibold ${examTimeLeft < 300 ? 'text-red-500' : 'text-amber-400'}`}>
                    {Math.floor(examTimeLeft / 60)}:{(examTimeLeft % 60).toString().padStart(2, '0')}
                  </div>
                  <div className="text-sm text-zinc-400">
                    {examCurrentIdx + 1} / {examQuestions.length}
                  </div>
                  <button onClick={() => submitExam(false)} className="text-sm px-4 py-1.5 border border-red-600 text-red-400 rounded hover:bg-red-950/30">
                    提前交卷
                  </button>
                </div>

                <div className="flex flex-wrap gap-1 mb-4">
                  {examQuestions.map((_, i) => {
                    const isAnswered = !!examAnswers[examQuestions[i].id];
                    const isCurrent = i === examCurrentIdx;
                    return (
                      <button
                        key={i}
                        onClick={() => goToExamQuestion(i)}
                        className={`w-8 h-8 text-xs rounded ${isCurrent ? 'bg-amber-500 text-black' : isAnswered ? 'bg-emerald-900 text-emerald-300' : 'bg-zinc-800 text-zinc-400'} border border-zinc-700`}
                      >
                        {i + 1}
                      </button>
                    );
                  })}
                </div>

                {(() => {
                  const q = examQuestions[examCurrentIdx];
                  const userAns = examAnswers[q.id];
                  return (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="q-meta">第{q.chapter}章 · 第{q.number}题</span>
                        <span className="q-meta">{q.type}</span>
                      </div>

                      <div className="question-text mb-4">
                        {renderQuestionText(cleanQuestionText(q.question))}
                      </div>

                      <div className="space-y-2 mb-6">
                        {q.options.map((optText, i) => {
                          const L = getOptionLetter(i);
                          const displayText = (optText || '').replace(/^[A-Fa-f][.、．]\s*/, '');
                          const isSingle = q.type === '单选题';
                          const isSelected = isSingle 
                            ? userAns === L 
                            : Array.isArray(userAns) && userAns.includes(L);

                          return (
                            <button
                              key={i}
                              onClick={() => {
                                if (isSingle) {
                                  setExamAnswers(prev => ({ ...prev, [q.id]: L }));
                                } else {
                                  setExamAnswers(prev => {
                                    const current = Array.isArray(prev[q.id]) ? prev[q.id] : [];
                                    let next = current.includes(L) 
                                      ? current.filter(x => x !== L) 
                                      : [...current, L];
                                    next = next.sort();
                                    return { ...prev, [q.id]: next };
                                  });
                                }
                              }}
                              className={`opt-btn ${isSelected ? 'selected' : ''}`}
                            >
                              <div className="font-semibold w-6 shrink-0 text-amber-400">{L}.</div>
                              <div className="text-zinc-200">{displayText}</div>
                            </button>
                          );
                        })}
                      </div>

                      <div className="flex justify-between">
                        <button 
                          onClick={() => goToExamQuestion(examCurrentIdx - 1)} 
                          disabled={examCurrentIdx === 0}
                          className="px-4 py-2 border rounded disabled:opacity-40"
                        >
                          上一题
                        </button>
                        <button 
                          onClick={() => goToExamQuestion(examCurrentIdx + 1)} 
                          disabled={examCurrentIdx === examQuestions.length - 1}
                          className="px-4 py-2 border rounded disabled:opacity-40"
                        >
                          下一题
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {examState === 'results' && examResult && (
              <div className="card p-6">
                {/* Summary */}
                <div className="text-center mb-2">
                  <div className="uppercase tracking-[2px] text-xs text-zinc-400">考试结束</div>
                  <div className="text-6xl font-bold text-amber-400 tabular-nums mt-1">{examResult.score}</div>
                  <div className="text-xl text-zinc-400 -mt-1">分</div>
                </div>
                <div className="text-center mb-5 text-sm">
                  正确 <span className="font-semibold text-emerald-400">{examResult.correct}/{examResult.total}</span> 题
                  &nbsp;·&nbsp; 用时 {Math.floor((examResult.timeUsed || 0) / 60)}分 {(examResult.timeUsed || 0) % 60}秒
                  {examResult.isTimeout && <span className="text-red-400 ml-1">(超时)</span>}
                </div>

                <div className="grid grid-cols-2 gap-3 mb-5 text-center text-sm">
                  <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-700">
                    单选 <span className="font-semibold text-amber-400">{examResult.single?.correct}/{examResult.single?.total}</span>
                  </div>
                  <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-700">
                    多选 <span className="font-semibold text-amber-400">{examResult.multi?.correct}/{examResult.multi?.total}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex flex-wrap gap-2 mb-6">
                  <button onClick={exitExam} className="flex-1 min-w-[120px] py-2.5 border rounded-xl">返回设置</button>
                  <button
                    onClick={() => {
                      setExamAnswers({});
                      setExamTimeLeft(30 * 60);
                      setExamCurrentIdx(0);
                      setExamResult(null);
                      setExamState('taking');
                    }}
                    className="flex-1 min-w-[160px] py-2.5 bg-amber-500 hover:bg-amber-600 text-black font-semibold rounded-xl"
                  >
                    用相同题目再考一次
                  </button>
                  <button
                    onClick={() => { setExamCurrentIdx(0); }}
                    className="px-4 py-2.5 border border-zinc-600 rounded-xl text-sm"
                  >
                    重置答题卡查看位置
                  </button>
                </div>

                {/* === 答题卡 === */}
                <div className="border-t border-zinc-700 pt-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-semibold text-lg flex items-center gap-2">
                      答题卡
                      <span className="text-xs font-normal px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">{examResult.details?.length || 0} 题</span>
                    </div>
                    <div className="text-xs text-zinc-400">绿色=正确，红色=错误，点击题号可快速定位</div>
                  </div>

                  {/* Nav pills for answer card (colored) */}
                  <div className="flex flex-wrap gap-1 mb-4">
                    {(examResult.details || []).map((d, i) => {
                      const isCurrent = i === examCurrentIdx;
                      return (
                        <button
                          key={i}
                          onClick={() => goToExamQuestion(i)}
                          className={`w-8 h-8 text-xs rounded font-medium transition border
                            ${isCurrent ? 'ring-2 ring-amber-400 border-amber-400' : ''}
                            ${d.isCorrect
                              ? 'bg-emerald-900/70 text-emerald-300 border-emerald-800'
                              : 'bg-red-900/70 text-red-300 border-red-800'}`}
                          title={`第${i+1}题 · ${d.isCorrect ? '正确' : '错误'}`}
                        >
                          {i + 1}
                        </button>
                      );
                    })}
                  </div>

                  {/* Focused question full view in 答题卡 */}
                  {(() => {
                    const q = examQuestions[examCurrentIdx];
                    if (!q) return null;
                    const detail = (examResult.details || [])[examCurrentIdx];
                    const userAnsRaw = examAnswers[q.id];
                    const userLetters = q.type === '单选题'
                      ? (typeof userAnsRaw === 'string' ? [userAnsRaw] : [])
                      : (Array.isArray(userAnsRaw) ? userAnsRaw : []);
                    const correctLetters = (detail?.correctNorm || '').split('');

                    return (
                      <div className="mb-5 p-4 rounded-2xl bg-zinc-950 border border-zinc-700">
                        <div className="flex items-center gap-2 mb-2 text-sm">
                          <span className="q-meta">第{q.chapter}章 · #{q.number}</span>
                          <span className="q-meta">{q.type}</span>
                          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${detail?.isCorrect ? 'bg-emerald-900 text-emerald-300' : 'bg-red-900 text-red-300'}`}>
                            {detail?.isCorrect ? '回答正确' : '回答错误'}
                          </span>
                        </div>

                        <div className="question-text mb-3 text-[15px]">
                          {renderQuestionText(cleanQuestionText(q.question))}
                        </div>

                        <div className="space-y-1.5">
                          {q.options.map((optText, oi) => {
                            const L = getOptionLetter(oi);
                            const display = (optText || '').replace(/^[A-Fa-f][.、．]\s*/, '');
                            const isUser = userLetters.includes(L);
                            const isCorrect = correctLetters.includes(L);

                            let cls = 'opt-btn flex items-center gap-2';
                            if (isCorrect) cls += ' !border-emerald-500 !bg-emerald-950/40';
                            if (isUser && !isCorrect) cls += ' !border-red-500 !bg-red-950/40';
                            if (isUser && isCorrect) cls += ' !border-emerald-400';

                            return (
                              <div key={oi} className={cls}>
                                <div className={`font-semibold w-6 shrink-0 ${isCorrect ? 'text-emerald-400' : isUser ? 'text-red-400' : 'text-amber-400'}`}>
                                  {L}.
                                </div>
                                <div className="text-zinc-200 flex-1">{display}</div>
                                {isCorrect && <span className="text-[10px] px-1.5 py-px rounded bg-emerald-800 text-emerald-300">正确</span>}
                                {isUser && !isCorrect && <span className="text-[10px] px-1.5 py-px rounded bg-red-800 text-red-300">你的选择</span>}
                                {isUser && isCorrect && <span className="text-[10px] px-1.5 py-px rounded bg-emerald-700 text-emerald-200">你的选择 ✓</span>}
                              </div>
                            );
                          })}
                        </div>

                        <div className="mt-3 text-xs text-zinc-400">
                          你的答案：<span className={detail?.isCorrect ? 'text-emerald-400' : 'text-red-400 font-medium'}>
                            {Array.isArray(userAnsRaw) ? userAnsRaw.join(' ') : (userAnsRaw || '未作答')}
                          </span>
                          &nbsp;&nbsp; 正确答案：<span className="text-emerald-400 font-medium">{detail?.correctNorm || '—'}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Compact full list (速览) */}
                  <div>
                    <div className="text-sm font-medium mb-2 text-zinc-300">全部答题情况速览</div>
                    <div className="space-y-1.5 max-h-[380px] overflow-auto pr-1 text-sm">
                      {(examResult.details || []).map((d, idx) => {
                        const shortQ = cleanQuestionText(d.q.question || '').slice(0, 42) + (cleanQuestionText(d.q.question || '').length > 42 ? '…' : '');
                        const isCur = idx === examCurrentIdx;
                        return (
                          <button
                            key={idx}
                            onClick={() => goToExamQuestion(idx)}
                            className={`w-full text-left px-3 py-2 rounded-xl border flex gap-3 items-start hover:bg-zinc-900/60 transition ${isCur ? 'border-amber-500 bg-zinc-900' : 'border-zinc-700'}`}
                          >
                            <div className={`w-6 h-6 rounded text-xs flex items-center justify-center shrink-0 mt-0.5 font-medium ${d.isCorrect ? 'bg-emerald-800 text-emerald-300' : 'bg-red-800 text-red-300'}`}>
                              {idx + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="text-zinc-200 leading-snug">{shortQ}</div>
                              <div className="mt-0.5 text-xs text-zinc-400">
                                你：<span className={d.isCorrect ? 'text-emerald-400' : 'text-red-400'}>{Array.isArray(d.userAnswer) ? d.userAnswer.join('') : (d.userAnswer || '—')}</span>
                                &nbsp; / 正确：<span className="text-emerald-400">{d.correctNorm}</span>
                              </div>
                            </div>
                            <div className={`text-xs px-2 py-0.5 rounded self-center ${d.isCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                              {d.isCorrect ? '✓' : '✗'}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-zinc-700 text-[11px] text-center text-zinc-500">
                  历史记录与本次考试均可在此完整查看答题卡 · 点击上方题号或列表项可定位详情
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'browse' && (
          <div className="space-y-3">
            {filteredQuestions.length === 0 && <div className="text-center py-10 text-slate-500">没有匹配的题目</div>}
            {filteredQuestions.map((q) => {
              const sup = supplements[q.id];
              const isExp = expandedId === q.id;
              return (
                <div key={q.id} className="card p-4">
                  <div className="flex items-start gap-3">
                    <div className="shrink-0">
                      <div className="q-meta mb-0.5">第{q.chapter}章</div>
                      <div className="text-[11px] text-slate-400">#{q.number}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-2 py-px rounded ${q.type === '多选题' ? 'bg-violet-100 text-violet-700' : 'bg-blue-100 text-blue-700'}`}>{q.type}</span>
                        {sup && <span className="text-[10px] px-1.5 bg-emerald-100 text-emerald-700 rounded">已补充答案</span>}
                        {mastered.has(q.id) && <span className="text-emerald-600 text-xs">✓已掌握</span>}
                      </div>
                      <div className="question-text mt-1.5 leading-snug cursor-pointer" onClick={() => setExpandedId(isExp ? null : q.id)}>
                        {cleanQuestionText(q.question)}
                      </div>

                      {isExp && (
                        <div className="mt-4 pl-1">
                          {(() => {
                            const eff = getEffectiveForQuestion(q, supplements);
                            if (eff.options.length > 0) {
                              return (
                                <div className="mb-3">
                                  <div className="text-xs uppercase tracking-widest text-slate-500 mb-1">
                                    标准答案 {eff.source === 'user' && <span className="text-emerald-600">(用户覆盖)</span>}
                                  </div>
                                  <div className="font-mono text-sm mb-1">{eff.answer}</div>
                                  <ol className="text-sm space-y-0.5 list-decimal list-inside">
                                    {eff.options.map((o, i) => {
                                      const display = (o || '').replace(/^[A-Fa-f][.、．]\s*/, '');
                                      return <li key={i}>{getOptionLetter(i)}. {display}</li>;
                                    })}
                                  </ol>
                                </div>
                              );
                            }
                            return <div className="text-sm text-amber-600 mb-2">题库中暂无选项/答案</div>;
                          })()}

                          <div className="flex flex-wrap gap-2">
                            <button onClick={() => openEditorFor(q.id)} className="text-sm px-4 py-1.5 rounded-xl border">编辑 / 补充答案</button>
                            <button onClick={() => toggleMastered(q.id)} className="text-sm px-4 py-1.5 rounded-xl border">{mastered.has(q.id) ? '取消掌握' : '标记已掌握'}</button>
                            <button onClick={() => toggleBookmark(q.id)} className="text-sm px-4 py-1.5 rounded-xl border">{bookmarks.has(q.id) ? '取消收藏' : '加入收藏'}</button>
                            {sup && <button onClick={() => deleteSupplement(q.id)} className="text-sm px-4 py-1.5 rounded-xl border text-red-600">删除答案</button>}
                          </div>

                          {editingId === q.id && (
                            <SupplementEditor
                              options={editOptions}
                              answer={editAnswer}
                              setOptions={setEditOptions}
                              setAnswer={setEditAnswer}
                              onSave={() => saveSupplement(q.id, editOptions, editAnswer)}
                              onCancel={closeEditor}
                            />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="text-right text-xs text-slate-400 w-16">
                      {bookmarks.has(q.id) && '★'} {mastered.has(q.id) && '✓'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* WRONGS / BOOKMARKS TAB */}
        {activeTab === 'wrongs' && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <div>共 {wrongCount + bookmarkCount} 道重点题（错题 + 收藏）</div>
              <button onClick={startWrongOrBookmarkedSession} className="px-4 py-2 bg-red-600 text-white rounded-xl text-sm flex gap-2 items-center"><RefreshCw size={15}/> 重新刷这些题</button>
            </div>

            {[...wrongs, ...bookmarks].size === 0 && <div className="text-slate-500">还没有错题或收藏题。练习时点击「我答错了」或星标即可加入。</div>}

            <div className="grid gap-3">
              {ALL_QUESTIONS.filter(q => wrongs.has(q.id) || bookmarks.has(q.id)).map(q => (
                <div key={q.id} className="card p-4 flex gap-3 items-start">
                  <div>
                    <div className="q-meta">第{q.chapter}章 #{q.number} {q.type}</div>
                    <div className="mt-1 text-sm">{cleanQuestionText(q.question)}</div>
                  </div>
                  <div className="ml-auto flex gap-2 shrink-0">
                    <button onClick={() => toggleBookmark(q.id)} className="text-xs px-2 py-1 border rounded">{bookmarks.has(q.id) ? '取消收藏' : '收藏'}</button>
                    {wrongs.has(q.id) && <button onClick={() => removeFromWrongs(q.id)} className="text-xs px-2 py-1 border rounded text-red-600">移出错题</button>}
                    <button onClick={() => { setSessionIds([q.id]); setSessionIdx(0); setSessionActive(true); resetCurrentChoiceAndFeedback(); setActiveTab('practice'); }} className="text-xs px-3 py-1 bg-blue-600 text-white rounded">练习这题</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STATS TAB */}
        {activeTab === 'stats' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div className="card p-5">
              <div className="font-semibold mb-4">总体进度</div>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between"><span>总题量</span><span className="font-semibold">{total}</span></div>
                <div className="flex justify-between"><span>已掌握</span><span className="font-semibold text-emerald-600">{masteredCount}（{Math.round(masteredCount / total * 100)}%）</span></div>
                <div className="flex justify-between"><span>已补充答案</span><span className="font-semibold">{supplementCount}</span></div>
                <div className="flex justify-between"><span>错题数量</span><span className="font-semibold text-red-600">{wrongCount}</span></div>
                <div className="flex justify-between"><span>收藏数量</span><span>{bookmarkCount}</span></div>
              </div>
            </div>

            <div className="card p-5">
              <div className="font-semibold mb-3">各章掌握情况</div>
              {CHAPTERS.map(ch => {
                const s = chapterStats[ch];
                return (
                  <div key={ch} className="mb-3">
                    <div className="flex justify-between text-sm mb-1">
                      <span>第{ch}章</span>
                      <span>{s.mastered}/{s.total} <span className="text-slate-400">({s.pct}%)</span></span>
                    </div>
                    <div className="progress-bar"><div className="progress-fill bg-emerald-600" style={{ width: s.pct + '%' }} /></div>
                  </div>
                );
              })}
            </div>

            <div className="md:col-span-2 card p-5 text-sm text-slate-500">
              提示：掌握标记是手动操作（或练习后自行标记）。答案补充后可进行真实自动批改，正确率会更可靠。
            </div>
          </div>
        )}

        {/* MANAGE TAB — supplement answers */}
        {activeTab === 'manage' && (
          <div>
            <div className="flex gap-3 mb-4">
              <button onClick={exportSupplements} className="flex items-center gap-2 px-4 py-2 rounded-xl border hover:bg-slate-50 dark:hover:bg-slate-800">
                <Download size={16} /> 导出已补充答案 (JSON)
              </button>
              <label className="cursor-pointer flex items-center gap-2 px-4 py-2 rounded-xl border hover:bg-slate-50 dark:hover:bg-slate-800">
                <Upload size={16} /> 导入答案
                <input type="file" accept=".json" onChange={importSupplements} className="hidden" />
              </label>
              <div className="text-sm self-center text-slate-500">已保存 {supplementCount} 道题的答案</div>
            </div>

            <div className="card overflow-hidden">
              {Object.keys(supplements).length === 0 && (
                <div className="p-8 text-center text-slate-500">还没有补充任何答案。在练习或浏览时可以添加。</div>
              )}
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {Object.entries(supplements).map(([idStr, sup]) => {
                  const id = Number(idStr);
                  const q = ALL_QUESTIONS.find(x => x.id === id);
                  if (!q) return null;
                  return (
                    <div key={id} className="p-4 flex gap-4 items-start">
                      <div className="text-xs w-20 shrink-0 pt-1">
                        第{q.chapter}章<br />#{q.number}
                      </div>
                      <div className="flex-1 text-sm">
                        <div>{cleanQuestionText(q.question)}</div>
                        <div className="mt-2 text-emerald-700 dark:text-emerald-400 font-mono text-xs">答案：{sup.answer}</div>
                        <div className="text-xs mt-1 text-slate-500">选项：{sup.options.map((o, i) => `${getOptionLetter(i)}.${o}`).join('  ')}</div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => openEditorFor(id)} className="text-xs px-3 py-1 border rounded">编辑</button>
                        <button onClick={() => deleteSupplement(id)} className="text-xs px-3 py-1 border text-red-600 rounded">删除</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500">补充的答案保存在浏览器本地，清除浏览器数据或使用「重置」会丢失。</div>
          </div>
        )}
      </div>

      {/* Floating editor modal (used from session or anywhere) */}
      {editingId !== null && activeTab !== 'browse' && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[70]" onClick={closeEditor}>
          <div className="card w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
            <div className="font-semibold mb-3">补充 / 编辑答案</div>
            <SupplementEditor
              options={editOptions}
              answer={editAnswer}
              setOptions={setEditOptions}
              setAnswer={setEditAnswer}
              onSave={() => {
                const ok = saveSupplement(editingId, editOptions, editAnswer);
                if (ok && sessionActive) {
                  // refresh current view
                }
              }}
              onCancel={closeEditor}
            />
            <div className="text-xs text-slate-500 mt-3">答案格式示例：单选填 A，多选填 AC 或 A,C</div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 px-5 py-2.5 rounded-2xl shadow text-sm ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'}`}>
          {toast.msg}
        </div>
      )}

      <footer className="text-center text-xs text-slate-400 py-8">
        数据来源：cleaned_question_bank.json（{total} 题） · 本地存储 · React + Tailwind
      </footer>
    </div>
  );
}

// Reusable small editor component
function SupplementEditor({ options, answer, setOptions, setAnswer, onSave, onCancel }) {
  function updateOpt(i, val) {
    const copy = [...options];
    copy[i] = val;
    setOptions(copy);
  }
  function addOpt() {
    if (options.length >= 6) return;
    setOptions([...options, '']);
  }
  function removeOpt(i) {
    if (options.length <= 2) return;
    setOptions(options.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <div className="space-y-2">
        {options.map((opt, i) => (
          <div key={i} className="flex gap-2 items-center">
            <div className="w-6 text-sm font-semibold text-blue-600">{getOptionLetter(i)}.</div>
            <input
              value={opt}
              onChange={(e) => updateOpt(i, e.target.value)}
              placeholder="输入选项内容"
              className="flex-1 px-3 py-2 border rounded-xl text-sm dark:bg-slate-900"
            />
            {options.length > 2 && (
              <button onClick={() => removeOpt(i)} className="text-red-400 px-1">×</button>
            )}
          </div>
        ))}
      </div>

      <button onClick={addOpt} className="text-xs mt-2 text-blue-600 hover:underline">+ 添加选项（最多6个）</button>

      <div className="mt-4">
        <div className="text-sm mb-1 text-slate-600 dark:text-slate-400">正确答案</div>
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="例如：B  或  AC"
          className="w-full px-3 py-2 border rounded-xl font-mono tracking-[2px] text-sm dark:bg-slate-900"
        />
      </div>

      <div className="flex gap-3 mt-5">
        <button onClick={onSave} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl">保存答案</button>
        <button onClick={onCancel} className="flex-1 py-2.5 border rounded-2xl">取消</button>
      </div>
    </div>
  );
}
