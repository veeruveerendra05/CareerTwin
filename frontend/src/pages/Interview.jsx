import { useState, useRef, useEffect } from 'react';
import { 
  Mic, MicOff, Video, VideoOff, Maximize, Minimize, Volume2, VolumeX, 
  Play, CheckCircle2, XCircle, ChevronRight, RefreshCw, Award, 
  ArrowLeft, Sparkles, Code2, Bot, ShieldCheck, AlertTriangle, 
  FileText, Briefcase, Layers, 
  Clock, User, BookOpen, Target, Check, RotateCcw
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { 
  startInterview, submitAnswer, runCodeExecution, getInterviewResult, 
  getInterviewHistory, getInterviewVoices, fetchSpeechifyAudio 
} from '../features/interview/interviewService';
import { getResumes } from '../features/resume/resumeService';
import { waitForAuthReady } from '../api/axiosClient';
import { Progress } from '../components/ui/Progress';
import { auth } from '../firebase';

// ---------------------------------------------------------------------------
// FORMATS & CONFIGURATIONS
// ---------------------------------------------------------------------------
const INTERVIEW_FORMATS = [
  { value: 'technical', label: 'Technical Assessment', desc: 'Part A: Technical MCQs + Part B: Architecture & CS Fundamentals' },
  { value: 'scenario', label: 'Scenario-Based Defense', desc: 'Part A: Diagnostic MCQs + Part B: Production Outages & Concurrency' },
  { value: 'coding', label: 'Hands-on Coding IDE', desc: 'Algorithmic challenges with interactive Code Editor & Test Cases' },
  { value: 'mcq', label: 'Multiple-Choice (MCQ)', desc: 'Part A: Full session of timed conceptual MCQs with voice/click' },
  { value: 'hr', label: 'HR & Behavioral Viva', desc: 'Part B: STAR-format situational questions, leadership & conflict resolution' },
  { value: 'resume_based', label: 'Resume-Based Interview', desc: 'Part B: Deep technical defense of your actual uploaded resume projects' },
  { value: 'company_specific', label: 'Company-Specific Assessment', desc: 'Authentic hiring rubrics for your target employer' },
  { value: 'mixed', label: 'Comprehensive Full Round', desc: 'Part A: MCQs + Part B: Voice Explanations + Coding IDE' },
];

const EXPERIENCE_LEVELS = [
  { value: 'fresher', label: 'Fresher / Entry-Level', desc: 'Graduates, 0-1 years' },
  { value: 'intermediate', label: 'Intermediate', desc: '1-3 years experience' },
  { value: 'experienced', label: 'Experienced', desc: '3+ years experience' },
];

const TARGET_ROLES = [
  'Software Engineer',
  'Backend Developer',
  'Frontend Developer',
  'Full-Stack Developer',
  'Python Developer',
  'Data Analyst / AI Engineer',
  'Cloud / DevOps Engineer',
];

export default function Interview() {
  const [searchParams] = useSearchParams();
  const initialRole = searchParams.get('role') || 'Software Engineer';

  // -------------------------------------------------------------------------
  // FORM / CONFIGURATION STATE
  // -------------------------------------------------------------------------
  const [targetRole, setTargetRole] = useState(initialRole);
  const [customRole, setCustomRole] = useState('');
  const [roundType, setRoundType] = useState('technical');
  const [difficulty, setDifficulty] = useState('medium');
  const [experienceLevel, setExperienceLevel] = useState('fresher');
  const [questionCount, setQuestionCount] = useState(5);
  const [jobDescription, setJobDescription] = useState('');
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [userResumes, setUserResumes] = useState([]);

  // Session & Flow States: 'setup' | 'in_session' | 'question_evaluated' | 'completed' | 'history'
  const [phase, setPhase] = useState('setup');
  const [loading, setLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [startError, setStartError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  // Response inputs
  const [selectedOption, setSelectedOption] = useState(null);
  const [spokenTranscript, setSpokenTranscript] = useState('');
  const [codeSolution, setCodeSolution] = useState('');
  const [codeLanguage, setCodeLanguage] = useState('python');
  const [codeRunOutput, setCodeRunOutput] = useState(null);
  const [runningCode, setRunningCode] = useState(false);

  // Session Results & History
  const [evaluations, setEvaluations] = useState([]);
  const [currentEvaluation, setCurrentEvaluation] = useState(null);
  const [finalReport, setFinalReport] = useState(null);
  const [pastSessions, setPastSessions] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Hardware & Speech State
  const [cameraActive, setCameraActive] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isBotSpeaking, setIsBotSpeaking] = useState(false);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Voice Provider
  const [selectedVoice, setSelectedVoice] = useState('dominic_32');
  const [availableVoices, setAvailableVoices] = useState([]);

  // Timers
  const [sessionTimeElapsed, setSessionTimeElapsed] = useState(0);

  // Refs
  const videoRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const speechRecognitionRef = useRef(null);
  const currentAudioRef = useRef(null);
  const timerIntervalRef = useRef(null);
  const isListeningRef = useRef(false);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  const startCameraAndMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setCameraActive(true);
      return true;
    } catch (err) {
      console.warn('Camera/Mic permission warning:', err);
      setCameraActive(false);
      return false;
    }
  };

  const stopCameraAndMic = () => {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    setCameraActive(false);
  };

  // -------------------------------------------------------------------------
  // INITIALIZATION
  // -------------------------------------------------------------------------
  useEffect(() => {
    const uid = auth?.currentUser?.uid || localStorage.getItem('career_user') || 'demo-student';
    getResumes(uid)
      .then(res => {
        if (Array.isArray(res)) setUserResumes(res);
        else if (res?.resumes) setUserResumes(res.resumes);
      })
      .catch(() => {});

    getInterviewVoices()
      .then(res => {
        if (res?.voices) setAvailableVoices(res.voices);
      })
      .catch(() => {});

    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Timers when in session
  useEffect(() => {
    if (phase === 'in_session' || phase === 'question_evaluated') {
      timerIntervalRef.current = setInterval(() => {
        setSessionTimeElapsed(prev => prev + 1);
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }
    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [phase]);

  // Ensure video element receives stream when camera is active
  useEffect(() => {
    if (cameraActive && mediaStreamRef.current && videoRef.current) {
      videoRef.current.srcObject = mediaStreamRef.current;
    }
  }, [cameraActive, phase]);

  // -------------------------------------------------------------------------
  // SPEECH RECOGNITION (VOICE INPUT)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event) => {
        let currentText = '';
        for (let i = 0; i < event.results.length; i++) {
          currentText += event.results[i][0].transcript + ' ';
        }
        setSpokenTranscript(currentText.trim());
      };

      recognition.onerror = (e) => {
        console.warn('Speech recognition notice:', e.error);
        if (e.error === 'not-allowed') {
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        if (isListeningRef.current) {
          try { recognition.start(); } catch { void 0; }
        }
      };

      speechRecognitionRef.current = recognition;
    }

    return () => {
      stopCameraAndMic();
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch { void 0; }
      }
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch { void 0; }
      }
      window.speechSynthesis?.cancel();
    };
  }, []);

  // -------------------------------------------------------------------------
  // SPEECH SYNTHESIS (VOICE OUTPUT)
  // -------------------------------------------------------------------------
  const fallbackSpeak = (cleanText) => {
    if (!window.speechSynthesis) {
      setIsBotSpeaking(false);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.0;
    utterance.pitch = 1.02;

    const voices = window.speechSynthesis.getVoices();
    const naturalVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Google') || v.name.includes('Samantha')));
    if (naturalVoice) utterance.voice = naturalVoice;

    utterance.onstart = () => setIsBotSpeaking(true);
    utterance.onend = () => setIsBotSpeaking(false);
    utterance.onerror = () => setIsBotSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const speakText = async (text) => {
    if (!ttsEnabled || !text) return;
    if (currentAudioRef.current) {
      try {
        currentAudioRef.current.pause();
        currentAudioRef.current.currentTime = 0;
      } catch { void 0; }
    }
    window.speechSynthesis?.cancel();

    const cleanText = text
      .replace(/```[\s\S]*?```/g, 'Refer to the code challenge on your screen.')
      .replace(/[*_#`]/g, '')
      .substring(0, 450);

    try {
      setIsBotSpeaking(true);
      const audioUrl = await fetchSpeechifyAudio(cleanText, selectedVoice);
      const audio = new Audio(audioUrl);
      currentAudioRef.current = audio;
      audio.onended = () => setIsBotSpeaking(false);
      audio.onerror = () => fallbackSpeak(cleanText);
      await audio.play();
    } catch {
      fallbackSpeak(cleanText);
    }
  };

  // -------------------------------------------------------------------------
  // HARDWARE & FULLSCREEN CONTROLS
  // -------------------------------------------------------------------------
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        elem.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
      } else if (elem.webkitRequestFullscreen) {
        elem.webkitRequestFullscreen();
        setIsFullscreen(true);
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
        setIsFullscreen(false);
      }
    }
  };

  const toggleMicListening = () => {
    if (!speechRecognitionRef.current) {
      alert('Speech recognition is not available in this browser. Please type or select your response.');
      return;
    }
    if (isListening) {
      speechRecognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        speechRecognitionRef.current.start();
        setIsListening(true);
      } catch {
        setIsListening(false);
      }
    }
  };

  // -------------------------------------------------------------------------
  // INTERVIEW SESSION WORKFLOW
  // -------------------------------------------------------------------------
  const handleStartSession = async () => {
    if (loading) return;
    setStartError(null);

    // Step 1: Validate interview parameters
    const effectiveRole = (customRole.trim() || targetRole || '').trim();
    if (!effectiveRole) {
      setStartError('Please select or specify a Target Role before starting the session.');
      return;
    }

    if (!questionCount || questionCount < 1 || questionCount > 20) {
      setStartError('Please select a question count between 1 and 20.');
      return;
    }

    setLoading(true);
    setLoadingStep('Verifying authentication...');

    try {
      // Step 2: Ensure Firebase auth initialization has completed
      const currentUser = await waitForAuthReady();
      const localToken = localStorage.getItem('career_access_token');
      const localUser = localStorage.getItem('career_user');

      if (!currentUser && !localToken && !localUser) {
        throw new Error('You must be signed in to start an interview session. Please sign in or refresh your session.');
      }

      // Pre-flight token refresh if currentUser is active
      if (currentUser && typeof currentUser.getIdToken === 'function') {
        try {
          const freshToken = await currentUser.getIdToken(false);
          if (freshToken) {
            localStorage.setItem('career_access_token', freshToken);
            localStorage.setItem('career_user', currentUser.uid);
          }
        } catch (tokenErr) {
          console.warn('Pre-flight token refresh warning:', tokenErr);
        }
      }

      // Step 3: Initialize backend interview session
      setLoadingStep('Synthesizing role-tailored questions...');
      const data = await startInterview({
        type: roundType,
        target_role: effectiveRole,
        company: (searchParams.get('company') || '').trim() || undefined,
        difficulty,
        experience_level: experienceLevel,
        count: questionCount,
        resume_id: selectedResumeId || undefined,
        job_description: jobDescription.trim() || undefined,
      });

      // Step 4: Confirm successful session creation
      if (!data || !data.session_id || !Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error('The AI engine could not generate interview questions for this role. Please try again or adjust parameters.');
      }

      // Step 5: Request microphone & camera permission only AFTER session creation succeeds
      setLoadingStep('Initializing proctored camera & audio...');
      await startCameraAndMic();

      // Step 6: Initialize AI interviewer and session state
      setSession(data);
      setCurrentIndex(0);
      setEvaluations([]);
      setSelectedOption(null);
      setSpokenTranscript('');
      setCodeRunOutput(null);
      setCurrentEvaluation(null);

      const firstQ = data.questions[0];
      if (firstQ?.question_type === 'coding' && firstQ?.starter_code) {
        setCodeSolution(firstQ.starter_code);
      } else {
        setCodeSolution('');
      }

      // Step 7: Transition to in-session room
      setPhase('in_session');

      // Step 8: Read first question aloud
      if (firstQ?.question) {
        setTimeout(() => {
          let textToSpeak = firstQ.question;
          if (firstQ.options?.length) {
            textToSpeak += '. The choices are: ' + firstQ.options.join('. ');
          }
          speakText(textToSpeak);
        }, 600);
      }

      // Start live speech recognition for voice answers if non-coding
      if (speechRecognitionRef.current && firstQ?.question_type !== 'coding') {
        try {
          speechRecognitionRef.current.start();
          setIsListening(true);
        } catch { void 0; }
      }
    } catch (err) {
      stopCameraAndMic();
      const errMsg = err.response?.data?.detail || err.message || 'An unexpected error occurred while starting the interview.';
      setStartError(errMsg);
    } finally {
      setLoading(false);
      setLoadingStep('');
    }
  };

  const currentQuestion = session?.questions?.[currentIndex];

  // Run code against test cases in the sandbox
  const handleRunCode = async () => {
    if (!currentQuestion || !codeSolution.trim()) return;
    setRunningCode(true);
    setCodeRunOutput(null);
    try {
      const res = await runCodeExecution({
        code: codeSolution,
        test_cases: currentQuestion.test_cases || [],
      });
      setCodeRunOutput(res);
    } catch (err) {
      setCodeRunOutput({
        success: false,
        error: err.response?.data?.detail || err.message || 'Execution failed',
        passed: false,
        test_cases_passed: 0,
        total_test_cases: currentQuestion.test_cases?.length || 0,
      });
    } finally {
      setRunningCode(false);
    }
  };

  // Submit answer for evaluation
  const handleSubmitCurrentAnswer = async () => {
    if (!session || !currentQuestion || submitting) return;
    setSubmitting(true);

    try {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch { void 0; }
        setIsListening(false);
      }
      if (currentAudioRef.current) {
        try { currentAudioRef.current.pause(); } catch { void 0; }
      }
      window.speechSynthesis?.cancel();

      const qId = currentQuestion.question_id || `q_${currentIndex + 1}`;
      const payload = {
        question_id: qId,
        question: currentQuestion.question,
        question_type: currentQuestion.question_type || 'technical',
        target_role: session.target_role,
        expected_key_points: currentQuestion.expected_key_points || [],
        correct_option: currentQuestion.correct_option,
        explanation: currentQuestion.explanation,
      };

      if (currentQuestion.question_type === 'coding') {
        payload.answer = codeSolution;
        payload.code_results = codeRunOutput;
      } else if (currentQuestion.options?.length > 0) {
        payload.selected_option = selectedOption;
        payload.answer = spokenTranscript || (selectedOption ? `Option ${selectedOption}` : '');
      } else {
        payload.answer = spokenTranscript;
      }

      const res = await submitAnswer(session.session_id, payload);
      const evalData = res.evaluation;
      setCurrentEvaluation(evalData);
      setEvaluations(prev => [...prev, {
        question: currentQuestion,
        evaluation: evalData,
        answer: payload.answer,
        selectedOption: payload.selected_option
      }]);
      setPhase('question_evaluated');
    } catch (err) {
      alert('Answer evaluation error: ' + (err.response?.data?.detail || err.message));
    } finally {
      setSubmitting(false);
    }
  };

  const handleNextQuestion = async () => {
    const nextIndex = currentIndex + 1;
    if (nextIndex < session.questions.length) {
      setCurrentIndex(nextIndex);
      setSelectedOption(null);
      setSpokenTranscript('');
      setCodeRunOutput(null);
      setCurrentEvaluation(null);
      setPhase('in_session');

      const nextQ = session.questions[nextIndex];
      if (nextQ.question_type === 'coding' && nextQ.starter_code) {
        setCodeSolution(nextQ.starter_code);
      } else {
        setCodeSolution('');
      }

      setTimeout(() => {
        let nextText = nextQ.question;
        if (nextQ.options?.length) {
          nextText += '. The choices are: ' + nextQ.options.join('. ');
        }
        speakText(nextText);
      }, 500);

      if (speechRecognitionRef.current && nextQ.question_type !== 'coding') {
        try {
          speechRecognitionRef.current.start();
          setIsListening(true);
        } catch { void 0; }
      }
    } else {
      await handleFinishInterview();
    }
  };

  const handleFinishInterview = async () => {
    if (!session) return;
    setLoading(true);
    stopCameraAndMic();
    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch { void 0; }
      setIsListening(false);
    }
    try {
      const result = await getInterviewResult(session.session_id);
      setFinalReport(result);
      setPhase('completed');
    } catch (err) {
      alert('Failed to generate interview report: ' + (err.response?.data?.detail || err.message));
      setPhase('completed');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadPastHistory = async () => {
    setLoadingHistory(true);
    try {
      const data = await getInterviewHistory();
      setPastSessions(data.sessions || []);
      setPhase('history');
    } catch (err) {
      alert('Failed to load past interviews: ' + err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleViewArchivedReport = async (sessionId) => {
    setLoading(true);
    try {
      const report = await getInterviewResult(sessionId);
      setFinalReport(report);
      setPhase('completed');
    } catch {
      alert('Could not load report for session ' + sessionId);
    } finally {
      setLoading(false);
    }
  };

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Determine active section for question
  const isCodingQuestion = currentQuestion?.question_type === 'coding' || Boolean(currentQuestion?.starter_code);
  const isMcqQuestion = !isCodingQuestion && Boolean(currentQuestion?.options && currentQuestion.options.length > 0);
  const currentSectionName = isCodingQuestion 
    ? 'Part C: Hands-on Coding Assessment (IDE)' 
    : isMcqQuestion 
      ? 'Part A: Core Technical MCQs' 
      : 'Part B: Voice Explanations & Scenario Defense';

  // -------------------------------------------------------------------------
  // RENDER: SETUP VIEW
  // -------------------------------------------------------------------------
  if (phase === 'setup') {
    return (
      <div className="text-[#27113D] font-sans pb-12">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#F3E9FF] text-[#542477] text-xs font-bold uppercase tracking-wider mb-2 border border-[#E4D5F3]">
                <Sparkles size={14} /> Real-Time Mock Interview Studio
              </div>
              <h1 className="text-3xl sm:text-4xl font-extrabold text-[#27113D] tracking-tight">
                AI Mock Interview Studio
              </h1>
            </div>
            <button
              onClick={handleLoadPastHistory}
              disabled={loadingHistory}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-[#E4D5F3] bg-white text-[#542477] hover:bg-[#F3E9FF] font-semibold text-xs tracking-wide shadow-xs transition-all cursor-pointer"
            >
              <BookOpen size={16} /> Past Interview Reports
            </button>
          </div>

          {/* Setup Form Container */}
          <div className="bg-white rounded-3xl border border-[#E4D5F3] shadow-[0_8px_30px_rgb(84,36,119,0.06)] p-6 sm:p-10">
            <div className="space-y-8">
              {/* 1. Target Role / Discipline */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#542477] mb-2 flex items-center gap-1.5">
                  <Briefcase size={14} /> Target Role / Discipline
                </label>
                <select
                  value={targetRole}
                  onChange={(e) => setTargetRole(e.target.value)}
                  className="w-full px-4 py-3 rounded-2xl border border-[#E4D5F3] bg-[#FAF7FD] text-sm text-[#27113D] focus:bg-white focus:outline-none focus:border-[#542477] focus:ring-2 focus:ring-[#7951D1]/15 transition-all"
                >
                  {TARGET_ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                  <option value="Custom">✨ Other Custom Role...</option>
                </select>
                {targetRole === 'Custom' && (
                  <input
                    type="text"
                    placeholder="e.g. Distributed Systems Engineer"
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                    className="mt-2.5 w-full px-4 py-2.5 rounded-xl border border-[#E4D5F3] text-sm focus:outline-none focus:border-[#542477]"
                  />
                )}
              </div>

              {/* 2. Interview Format Selection */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-[#542477] mb-3 flex items-center gap-1.5">
                  <Layers size={14} /> Interview Format Structure
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {INTERVIEW_FORMATS.map((fmt) => (
                    <div
                      key={fmt.value}
                      onClick={() => setRoundType(fmt.value)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                        roundType === fmt.value
                          ? 'border-[#542477] bg-[#F3E9FF]/40 shadow-xs ring-2 ring-[#542477]/15'
                          : 'border-[#E4D5F3] bg-[#FAF7FD] hover:bg-white hover:border-[#542477]/40'
                      }`}
                    >
                      <div>
                        <div className="font-bold text-sm text-[#27113D] mb-1 flex items-center justify-between">
                          {fmt.label}
                          {roundType === fmt.value && <Check size={16} className="text-[#542477]" />}
                        </div>
                        <p className="text-xs text-[#8A7A9E] leading-relaxed">
                          {fmt.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. Experience, Difficulty & Questions */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-2">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#542477] mb-2 flex items-center gap-1.5">
                    <User size={14} /> Experience Level
                  </label>
                  <select
                    value={experienceLevel}
                    onChange={(e) => setExperienceLevel(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E4D5F3] bg-[#FAF7FD] text-sm text-[#27113D] focus:bg-white focus:outline-none focus:border-[#542477]"
                  >
                    {EXPERIENCE_LEVELS.map((exp) => (
                      <option key={exp.value} value={exp.value}>{exp.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#542477] mb-2 flex items-center gap-1.5">
                    <Target size={14} /> Difficulty Level
                  </label>
                  <div className="flex rounded-xl border border-[#E4D5F3] p-1 bg-[#FAF7FD]">
                    {['easy', 'medium', 'hard'].map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setDifficulty(lvl)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg capitalize transition-all cursor-pointer ${
                          difficulty === lvl
                            ? 'bg-[#542477] text-white shadow-xs'
                            : 'text-[#8A7A9E] hover:text-[#542477]'
                        }`}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#542477] mb-2 flex items-center gap-1.5">
                    <Clock size={14} /> Total Question Count
                  </label>
                  <div className="flex rounded-xl border border-[#E4D5F3] p-1 bg-[#FAF7FD]">
                    {[5, 10, 15].map((cnt) => (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setQuestionCount(cnt)}
                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                          questionCount === cnt
                            ? 'bg-[#542477] text-white shadow-xs'
                            : 'text-[#8A7A9E] hover:text-[#542477]'
                        }`}
                      >
                        {cnt} Questions
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* 4. Personalization: Saved Resume & Voice Persona */}
              <div className="border-t border-[#E4D5F3] pt-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#542477] mb-2 flex items-center gap-1.5">
                      <FileText size={14} /> Personalize with Saved Resume (Optional)
                    </label>
                    <select
                      value={selectedResumeId}
                      onChange={(e) => setSelectedResumeId(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#E4D5F3] bg-[#FAF7FD] text-sm text-[#27113D] focus:bg-white focus:outline-none focus:border-[#542477]"
                    >
                      <option value="">No Resume (General Assessment)</option>
                      {userResumes.map((r) => (
                        <option key={r.resume_id} value={r.resume_id}>
                          📄 {r.filename}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-[#542477] mb-2 flex items-center gap-1.5">
                      <Volume2 size={14} /> AI Voice Persona
                    </label>
                    <select
                      value={selectedVoice}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-[#E4D5F3] bg-[#FAF7FD] text-sm text-[#27113D] focus:bg-white focus:outline-none focus:border-[#542477]"
                    >
                      <option value="dominic_32">🎙️ Dominic (Principal Technical Lead)</option>
                      <option value="geffen_32">🎙️ Geffen (Engineering Manager)</option>
                      <option value="aaliya">🎙️ Aaliya (Senior Systems Architect)</option>
                      <option value="abhay">🎙️ Abhay (Staff Infrastructure Engineer)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-[#8A7A9E] mb-1.5">
                    Target Job Description Snippet (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Paste job description requirements to test specific skills..."
                    value={jobDescription}
                    onChange={(e) => setJobDescription(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-[#E4D5F3] bg-[#FAF7FD] text-xs text-[#27113D] focus:bg-white focus:outline-none focus:border-[#542477]"
                  />
                </div>
              </div>

              {/* Startup Error Banner */}
              {startError && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start justify-between gap-3 animate-in fade-in">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="font-bold block">Could not start interview session:</strong>
                      <p className="mt-0.5 leading-relaxed">{startError}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setStartError(null)}
                    className="text-rose-600 hover:text-rose-900 font-bold underline shrink-0 cursor-pointer text-[11px]"
                  >
                    Dismiss
                  </button>
                </div>
              )}

              {/* Start Interview Action */}
              <div className="pt-2">
                <button
                  onClick={handleStartSession}
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-[#542477] to-[#D83CC5] text-white font-bold py-4 px-8 rounded-full shadow-[0_4px_20px_rgba(84,36,119,0.25)] hover:shadow-[0_6px_28px_rgba(84,36,119,0.35)] hover:-translate-y-0.5 transition-all flex justify-center items-center gap-2 cursor-pointer text-base disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <RefreshCw size={20} className="animate-spin" />
                      {loadingStep || 'Synthesizing Interview Session...'}
                    </>
                  ) : (
                    <>
                      <Play size={20} />
                      Start Interview Session
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // RENDER: COCKPIT REAL-TIME INTERVIEW ROOM (IN SESSION & QUESTION EVALUATED)
  // -------------------------------------------------------------------------
  if (phase === 'in_session' || phase === 'question_evaluated') {
    if (!currentQuestion) {
      return (
        <div className="text-[#27113D] font-sans flex flex-col items-center justify-center p-12 text-center bg-white rounded-3xl border border-[#E4D5F3]">
          <h3 className="text-lg font-bold text-[#27113D] mb-2">Preparing Interview Session...</h3>
          <p className="text-sm text-[#8A7A9E] mb-6">If this takes more than a moment, return to setup and try again.</p>
          <button
            onClick={() => setPhase('setup')}
            className="px-5 py-2.5 rounded-full bg-[#542477] text-white text-xs font-bold hover:bg-[#3E165B] transition-colors cursor-pointer"
          >
            Back to Studio Setup
          </button>
        </div>
      );
    }
    return (
      <div className="text-[#27113D] font-sans flex flex-col pb-12">
        <div className="max-w-7xl mx-auto w-full flex flex-col gap-6">
          {/* Top Session Breadcrumb Bar */}
          <div className="flex items-center justify-between bg-white px-5 py-3 rounded-2xl border border-[#E4D5F3] shadow-xs">
            <div className="flex items-center gap-3">
              <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-xs font-bold uppercase tracking-wider text-[#542477]">
                Live Proctored Session • {session?.target_role || 'Candidate'}
              </span>
            </div>

            <div className="flex items-center gap-4">
              {/* Question & Section Indicator */}
              <div className="px-3 py-1 rounded-full bg-[#F3E9FF] text-[#542477] text-xs font-bold border border-[#E4D5F3]">
                Question {currentIndex + 1} of {session?.questions?.length || 1}
              </div>

              {/* Session Timer */}
              <div className="flex items-center gap-1.5 text-xs font-mono font-bold text-[#542477] bg-[#FAF7FD] px-3 py-1 rounded-full border border-[#E4D5F3]">
                <Clock size={13} /> {formatTimer(sessionTimeElapsed)}
              </div>

              {/* End Early */}
              <button
                onClick={handleFinishInterview}
                className="px-3 py-1 rounded-full border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 text-xs font-bold transition-all cursor-pointer"
              >
                End Session
              </button>
            </div>
          </div>

          {/* Main Cockpit Layout: 8 cols center, 4 cols proctored live webcam */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* =============================================================== */}
            {/* LEFT / CENTER: AI BOT AVATAR + PART A/B/C INTERVIEW INTERFACE */}
            {/* =============================================================== */}
            <div className="lg:col-span-8 flex flex-col gap-6">
              
              {/* Centered AI Bot Interviewer Avatar Cockpit */}
              <div className="bg-gradient-to-b from-[#2E1244] to-[#1A0A27] border border-[#542477]/40 rounded-3xl p-6 sm:p-8 flex flex-col items-center justify-center text-center relative overflow-hidden shadow-xl text-white">
                
                {/* Glowing Pulse Rings when Bot Speaks */}
                <div className="relative mb-4">
                  <div className={`w-24 h-24 rounded-full flex items-center justify-center bg-gradient-to-tr from-[#542477] to-[#D83CC5] shadow-2xl transition-all duration-300 ${
                    isBotSpeaking ? 'ring-8 ring-[#D83CC5]/40 scale-105' : 'ring-2 ring-white/20'
                  }`}>
                    <Bot size={44} className="text-white" />
                  </div>
                  {isBotSpeaking && (
                    <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-[#D83CC5] text-white text-[10px] font-black uppercase tracking-wider animate-pulse flex items-center gap-1 shadow-md">
                      <Volume2 size={11} /> Speaking
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <h3 className="font-heading font-extrabold text-white text-lg">VeriBot AI Interviewer</h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-[#D83CC5]/20 text-[#E4D5F3] text-[10px] font-bold uppercase tracking-wider border border-[#D83CC5]/30">
                    {session.target_role || 'Technical'} Assessment
                  </span>
                </div>

                {/* Voice & Speech Controls Bar with Speechify Voice Selector */}
                <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                  <span className="px-2.5 py-1 rounded-full bg-white/10 text-[#E4D5F3] text-[11px] font-bold flex items-center gap-1 border border-white/20 shadow-xs">
                    <Sparkles size={11} className="text-[#D83CC5]" /> Speechify AI (Simba 3.2)
                  </span>
                  <select
                    value={selectedVoice}
                    onChange={(e) => {
                      const newVoice = e.target.value;
                      setSelectedVoice(newVoice);
                      if (currentQuestion?.question) {
                        speakText(currentQuestion.question);
                      }
                    }}
                    className="px-3 py-1 rounded-full bg-white/10 text-white text-xs font-medium border border-white/20 focus:outline-none focus:border-[#D83CC5] cursor-pointer"
                    title="Change AI Interviewer Voice"
                  >
                    {availableVoices.slice(0, 8).map(v => (
                      <option key={v.id} value={v.id} className="bg-[#1A0A27] text-white">
                        {v.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => speakText(currentQuestion.question)}
                    className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-full text-xs font-semibold flex items-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                    title="Play question audio again"
                  >
                    <Volume2 size={13} /> Re-read
                  </button>
                  <button
                    onClick={() => {
                      if (ttsEnabled) {
                        currentAudioRef.current?.pause();
                        window.speechSynthesis?.cancel();
                        setIsBotSpeaking(false);
                      }
                      setTtsEnabled(!ttsEnabled);
                    }}
                    className="p-1.5 rounded-full text-white/70 hover:text-white bg-white/10 transition-colors cursor-pointer"
                    title={ttsEnabled ? 'Mute AI voice' : 'Enable AI voice'}
                  >
                    {ttsEnabled ? <Volume2 size={14} /> : <VolumeX size={14} className="text-rose-400" />}
                  </button>
                </div>

                {/* Section Banner: Part A vs Part B vs Part C */}
                <div className="mt-6 w-full max-w-2xl bg-white/10 border border-white/15 rounded-2xl p-5 text-left">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold text-[#E4D5F3] uppercase tracking-wider block">
                      {currentSectionName}
                    </span>
                    {currentQuestion.source && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/15 text-white/90 font-medium">
                        {currentQuestion.source.platform}
                      </span>
                    )}
                  </div>
                  <p className="text-base sm:text-lg font-medium text-white leading-relaxed">
                    {currentQuestion.question}
                  </p>
                </div>
              </div>

              {/* Code Snippet Box (If present in question) */}
              {currentQuestion.code_snippet && currentQuestion.code_snippet.trim() && (
                <div className="rounded-2xl border border-[#27113D]/20 bg-[#1E1E2E] text-white overflow-hidden shadow-md">
                  <div className="px-4 py-2.5 bg-black/40 border-b border-white/10 flex items-center justify-between text-xs text-gray-400 font-mono">
                    <span className="flex items-center gap-1.5 text-cyan-400">
                      <Code2 size={14} /> Technical Snippet / Context
                    </span>
                  </div>
                  <pre className="p-4 font-mono text-xs text-emerald-300 overflow-x-auto leading-relaxed whitespace-pre-wrap">
                    {currentQuestion.code_snippet}
                  </pre>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PART A: MULTIPLE-CHOICE QUESTIONS (MCQS)                       */}
              {/* ------------------------------------------------------------- */}
              {isMcqQuestion && (
                <div className="bg-white rounded-3xl border border-[#E4D5F3] p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-[#E4D5F3] pb-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#542477] flex items-center gap-2">
                      <Layers size={14} /> Part A: Select Your Choice
                    </div>
                    <span className="text-[11px] text-[#8A7A9E]">Click option to select or speak aloud</span>
                  </div>

                  <div className="flex flex-col gap-3">
                    {currentQuestion.options.map((opt, idx) => {
                      const optionLetter = opt.trim().substring(0, 1).toUpperCase();
                      const isSelected = selectedOption === optionLetter || selectedOption === opt;
                      const isCorrect = currentQuestion.correct_option === optionLetter;

                      let optionStyle = 'border-[#E4D5F3] bg-[#FAF7FD] hover:bg-white hover:border-[#542477]/50';
                      if (phase === 'question_evaluated') {
                        if (isCorrect) {
                          optionStyle = 'border-emerald-500 bg-emerald-50 text-emerald-900 font-semibold ring-2 ring-emerald-500/30';
                        } else if (isSelected && !isCorrect) {
                          optionStyle = 'border-rose-400 bg-rose-50 text-rose-900 ring-2 ring-rose-400/30';
                        }
                      } else if (isSelected) {
                        optionStyle = 'border-[#542477] bg-[#F3E9FF] text-[#27113D] ring-2 ring-[#542477]/20 shadow-xs';
                      }

                      return (
                        <button
                          key={idx}
                          type="button"
                          disabled={phase === 'question_evaluated'}
                          onClick={() => setSelectedOption(optionLetter)}
                          className={`p-4 rounded-2xl border text-left transition-all flex items-start gap-3.5 cursor-pointer ${optionStyle}`}
                        >
                          <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${
                            isSelected ? 'bg-[#542477] text-white' : 'bg-white border border-[#E4D5F3] text-[#542477]'
                          }`}>
                            {optionLetter}
                          </div>
                          <span className="text-xs md:text-sm leading-relaxed pt-0.5 font-medium">
                            {opt}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PART B: VOICE EXPLANATION & LIVE TRANSCRIPTION                 */}
              {/* ------------------------------------------------------------- */}
              {!isCodingQuestion && (
                <div className="bg-white rounded-3xl border border-[#E4D5F3] p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-[#E4D5F3] pb-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#542477] flex items-center gap-2">
                      <Mic size={14} className={isListening ? 'text-[#D83CC5] animate-pulse' : 'text-[#8A7A9E]'} />
                      {isMcqQuestion ? 'Candidate Spoken Option (Voice Input)' : 'Part B: Candidate Voice Response (Real-Time Live Transcription)'}
                    </div>
                    <button
                      onClick={toggleMicListening}
                      className={`px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                        isListening ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-[#542477] text-white hover:bg-[#431B60]'
                      }`}
                    >
                      {isListening ? <MicOff size={13} /> : <Mic size={13} />}
                      {isListening ? 'Pause Microphone' : 'Start Speaking'}
                    </button>
                  </div>

                  <div className="p-4 rounded-2xl bg-[#FAF7FD] border border-[#E4D5F3] min-h-[80px] text-xs text-[#27113D] leading-relaxed flex flex-col justify-between">
                    {spokenTranscript ? (
                      <p className="font-sans text-sm font-medium">{spokenTranscript}</p>
                    ) : (
                      <p className="text-[#8A7A9E] italic text-xs">
                        {isListening 
                          ? '🎙️ Listening... speak into your microphone. Words will transcribe here in real time.'
                          : 'Speak into your microphone or select an option above to answer.'}
                      </p>
                    )}
                    {spokenTranscript && (
                      <div className="mt-2 pt-2 border-t border-[#E4D5F3] flex justify-between items-center text-[10px] text-[#8A7A9E]">
                        <span>{spokenTranscript.split(/\s+/).length} words spoken</span>
                        <button onClick={() => setSpokenTranscript('')} className="text-rose-600 hover:underline">Clear</button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ------------------------------------------------------------- */}
              {/* PART C: HANDS-ON CODING IDE (WHEN QUESTION IS CODING)          */}
              {/* ------------------------------------------------------------- */}
              {isCodingQuestion && (
                <div className="bg-white rounded-3xl border border-[#E4D5F3] p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between border-b border-[#E4D5F3] pb-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-[#542477] flex items-center gap-2">
                      <Code2 size={16} /> Hands-on Coding Workspace
                    </div>
                    <select
                      value={codeLanguage}
                      onChange={(e) => setCodeLanguage(e.target.value)}
                      className="text-xs px-3 py-1 rounded-xl border border-[#E4D5F3] bg-[#FAF7FD] text-[#542477] font-semibold"
                    >
                      <option value="python">Python 3 (Sandboxed)</option>
                    </select>
                  </div>

                  <textarea
                    rows={12}
                    value={codeSolution}
                    onChange={(e) => setCodeSolution(e.target.value)}
                    placeholder="# Write your code function implementation here..."
                    className="w-full p-4 rounded-2xl bg-[#1E1E2E] text-[#CDD6F4] font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-[#542477] resize-y"
                    spellCheck={false}
                  />

                  {/* Run Code Action */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={handleRunCode}
                      disabled={runningCode || !codeSolution.trim()}
                      className="px-4 py-2 rounded-xl bg-[#FAF7FD] border border-[#E4D5F3] hover:bg-[#F3E9FF] text-[#542477] text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                    >
                      {runningCode ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
                      Run Test Cases
                    </button>
                    <span className="text-[11px] text-[#8A7A9E]">Safe Sandboxed Execution</span>
                  </div>

                  {/* Code Test Results Console */}
                  {codeRunOutput && (
                    <div className="p-3.5 rounded-2xl bg-[#FAF7FD] border border-[#E4D5F3] text-xs font-mono">
                      <div className="flex items-center justify-between font-bold mb-2">
                        <span className={codeRunOutput.passed ? 'text-emerald-700' : 'text-rose-700'}>
                          {codeRunOutput.passed ? '✅ All Tests Passed' : '⚠️ Test Failures'} ({codeRunOutput.test_cases_passed}/{codeRunOutput.total_test_cases})
                        </span>
                        <span className="text-gray-500 text-[11px]">{codeRunOutput.execution_time_ms}ms</span>
                      </div>
                      {codeRunOutput.error && (
                        <p className="text-rose-600 mb-2">{codeRunOutput.error}</p>
                      )}
                      <div className="space-y-1">
                        {codeRunOutput.details?.map((d, dIdx) => (
                          <div key={dIdx} className="flex items-center justify-between text-[11px]">
                            <span>Test #{d.test_case_number}:</span>
                            <span className={d.passed ? 'text-emerald-700 font-bold' : 'text-rose-600 font-bold'}>
                              {d.passed ? 'PASSED' : `Expected ${JSON.stringify(d.expected)}, got ${JSON.stringify(d.actual)}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Submit Answer Bar (When In Session) */}
              {phase === 'in_session' && (
                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={handleSubmitCurrentAnswer}
                    disabled={submitting || (!selectedOption && !spokenTranscript.trim() && !codeSolution.trim())}
                    className="px-8 py-3.5 rounded-full bg-gradient-to-r from-[#542477] to-[#D83CC5] text-white text-sm font-bold shadow-[0_4px_16px_rgba(84,36,119,0.25)] hover:shadow-[0_6px_22px_rgba(84,36,119,0.35)] transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        AI Evaluating Response...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={16} />
                        Submit Answer & Evaluate
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* AI Assessment Feedback Panel (When Question Evaluated) */}
              {phase === 'question_evaluated' && currentEvaluation && (
                <div className="bg-white rounded-3xl border-l-4 border-l-[#542477] border border-[#E4D5F3] p-6 shadow-lg space-y-4 animate-in slide-in-from-top-4 duration-300">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      {currentEvaluation.overall_score >= 70 ? (
                        <CheckCircle2 size={24} className="text-emerald-600" />
                      ) : (
                        <AlertTriangle size={24} className="text-amber-500" />
                      )}
                      <h4 className="font-heading font-extrabold text-base text-[#27113D]">
                        AI Assessment Feedback • Score: {currentEvaluation.overall_score}/100
                      </h4>
                    </div>
                    <button
                      onClick={handleNextQuestion}
                      className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#542477] to-[#D83CC5] text-white text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs cursor-pointer"
                    >
                      {currentIndex < (session?.questions?.length || 1) - 1 ? 'Next Question' : 'View Session Results'}
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  <p className="text-xs text-[#27113D] leading-relaxed bg-[#FAF7FD] p-4 rounded-2xl border border-[#E4D5F3]">
                    {currentEvaluation.feedback_summary || currentQuestion.explanation}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                    {currentEvaluation.strengths?.length > 0 && (
                      <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-2xl">
                        <strong className="text-emerald-800 font-bold block mb-1.5 flex items-center gap-1">
                          <Check size={13} /> Strengths
                        </strong>
                        <ul className="space-y-1 text-emerald-950">
                          {currentEvaluation.strengths.map((s, i) => (
                            <li key={i}>• {s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {currentEvaluation.areas_to_improve?.length > 0 && (
                      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
                        <strong className="text-amber-800 font-bold block mb-1.5 flex items-center gap-1">
                          <XCircle size={13} /> Areas to Improve
                        </strong>
                        <ul className="space-y-1 text-amber-950">
                          {currentEvaluation.areas_to_improve.map((imp, i) => (
                            <li key={i}>• {imp}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* =============================================================== */}
            {/* RIGHT COLUMN: LIVE PROCTORED WEBCAM & SESSION PROGRESS          */}
            {/* =============================================================== */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              
              {/* Webcam Picture-in-Picture Card with Direct Full Screen Access */}
              <div className="bg-[#1A0A27] rounded-3xl border border-[#542477]/40 overflow-hidden shadow-xl text-white">
                <div className="p-3.5 bg-black/40 border-b border-white/10 flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2 font-bold text-white text-xs">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    Live Proctored Stream
                  </span>
                  <div className="flex items-center gap-1.5">
                    {/* Direct Fullscreen Access Button */}
                    <button
                      onClick={handleToggleFullscreen}
                      className="p-1.5 rounded-lg text-white/70 hover:text-white bg-white/10 transition-colors cursor-pointer"
                      title={isFullscreen ? 'Exit Full Screen' : 'Direct Full Screen Access'}
                    >
                      {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
                    </button>
                    {/* Camera Toggle */}
                    <button
                      onClick={() => {
                        if (cameraActive) {
                          setCameraActive(false);
                        } else {
                          startCameraAndMic();
                        }
                      }}
                      className="p-1.5 rounded-lg text-white/70 hover:text-white bg-white/10 transition-colors cursor-pointer"
                      title={cameraActive ? 'Turn off camera' : 'Turn on camera'}
                    >
                      {cameraActive ? <Video size={14} className="text-emerald-400" /> : <VideoOff size={14} />}
                    </button>
                    {/* Mic Toggle */}
                    <button
                      onClick={toggleMicListening}
                      className="p-1.5 rounded-lg text-white/70 hover:text-white bg-white/10 transition-colors cursor-pointer"
                      title={isListening ? 'Mute mic' : 'Unmute mic'}
                    >
                      {isListening ? <Mic size={14} className="text-[#D83CC5]" /> : <MicOff size={14} />}
                    </button>
                  </div>
                </div>

                {/* Video Stream Element */}
                <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`w-full h-full object-cover transform -scale-x-100 ${cameraActive ? 'block' : 'hidden'}`}
                  />
                  {!cameraActive && (
                    <div className="flex flex-col items-center justify-center p-6 text-center text-gray-400">
                      <User size={36} className="text-gray-600 mb-2" />
                      <span className="text-xs">Camera stream paused</span>
                      <button
                        onClick={startCameraAndMic}
                        className="mt-3 px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-full text-[11px] font-semibold cursor-pointer"
                      >
                        Enable Camera
                      </button>
                    </div>
                  )}

                  {/* Face Outline Overlay */}
                  {cameraActive && (
                    <div className="absolute inset-0 pointer-events-none border-2 border-white/10 rounded-2xl m-3 flex items-center justify-center">
                      <div className="w-28 h-36 border border-dashed border-[#D83CC5]/50 rounded-full opacity-60"></div>
                    </div>
                  )}
                </div>

                <div className="p-3 bg-black/30 text-[11px] text-gray-400 flex justify-between items-center px-4">
                  <span>Candidate: Authenticated</span>
                  <span className="text-emerald-400 font-bold flex items-center gap-1">
                    <ShieldCheck size={13} /> Proctor Active
                  </span>
                </div>
              </div>

              {/* Session Progress Card */}
              <div className="bg-white rounded-3xl border border-[#E4D5F3] p-5 shadow-xs space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-[#542477] border-b border-[#E4D5F3] pb-2">
                  Assessment Overview
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-[#8A7A9E]">Progress:</span>
                    <strong className="text-[#27113D]">
                      {currentIndex + (phase === 'question_evaluated' ? 1 : 0)} / {session?.questions?.length || 5} Completed
                    </strong>
                  </div>
                  <Progress 
                    value={Math.round(((currentIndex + (phase === 'question_evaluated' ? 1 : 0)) / (session?.questions?.length || 5)) * 100)} 
                    colorClass="bg-[#542477]" 
                  />
                </div>

                {/* Section Structure Pill List */}
                <div className="pt-2 border-t border-[#E4D5F3] space-y-2 text-xs">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#8A7A9E] block">
                    Assessment Parts:
                  </span>
                  <div className="space-y-1.5">
                    <div className={`p-2 rounded-xl text-xs font-semibold flex items-center justify-between ${
                      isMcqQuestion ? 'bg-[#F3E9FF] text-[#542477] border border-[#542477]/30' : 'bg-[#FAF7FD] text-gray-600'
                    }`}>
                      <span>Part A: Technical MCQs</span>
                      {isMcqQuestion && <span className="text-[10px] font-bold bg-[#542477] text-white px-2 py-0.5 rounded-full">Active</span>}
                    </div>
                    <div className={`p-2 rounded-xl text-xs font-semibold flex items-center justify-between ${
                      !isMcqQuestion && !isCodingQuestion ? 'bg-[#F3E9FF] text-[#542477] border border-[#542477]/30' : 'bg-[#FAF7FD] text-gray-600'
                    }`}>
                      <span>Part B: Voice Explanations</span>
                      {!isMcqQuestion && !isCodingQuestion && <span className="text-[10px] font-bold bg-[#542477] text-white px-2 py-0.5 rounded-full">Active</span>}
                    </div>
                    <div className={`p-2 rounded-xl text-xs font-semibold flex items-center justify-between ${
                      isCodingQuestion ? 'bg-[#F3E9FF] text-[#542477] border border-[#542477]/30' : 'bg-[#FAF7FD] text-gray-600'
                    }`}>
                      <span>Part C: Hands-on Coding</span>
                      {isCodingQuestion && <span className="text-[10px] font-bold bg-[#542477] text-white px-2 py-0.5 rounded-full">Active</span>}
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-[#E4D5F3] text-xs text-[#8A7A9E] space-y-1">
                  <p>🎯 <strong>Target:</strong> {targetRole}</p>
                  <p>⚡ <strong>Format:</strong> {roundType.toUpperCase()}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // RENDER: COMPLETED SESSION SUMMARY SCORECARD
  // -------------------------------------------------------------------------
  if (phase === 'completed') {
    if (!finalReport) {
      return (
        <div className="text-[#27113D] font-sans flex flex-col items-center justify-center p-12 text-center bg-white rounded-3xl border border-[#E4D5F3]">
          <h3 className="text-lg font-bold text-[#27113D] mb-2">Finalizing Your Report</h3>
          <p className="text-sm text-[#8A7A9E] mb-6">Synthesizing scoring diagnostics and rubric evaluation...</p>
          <button
            onClick={() => { setPhase('setup'); setFinalReport(null); }}
            className="px-5 py-2.5 rounded-full bg-[#542477] text-white text-xs font-bold hover:bg-[#3E165B] transition-colors cursor-pointer"
          >
            Back to Studio Setup
          </button>
        </div>
      );
    }
    const overallScore = finalReport.overall_score || 75.0;
    const isPassing = overallScore >= 70;

    return (
      <div className="text-[#27113D] font-sans pb-12">
        <div className="max-w-4xl mx-auto space-y-8 animate-in zoom-in-95 duration-300">
          <div className="flex items-center justify-between">
            <button
              onClick={() => { setPhase('setup'); setFinalReport(null); }}
              className="inline-flex items-center gap-2 text-xs font-bold text-[#542477] hover:underline cursor-pointer"
            >
              <ArrowLeft size={16} /> Return to Studio Setup
            </button>
            <span className="text-xs font-mono text-[#8A7A9E]">Session: {finalReport.session_id}</span>
          </div>

          <div className="bg-white rounded-3xl border border-[#E4D5F3] p-8 shadow-[0_8px_30px_rgb(84,36,119,0.06)] text-center">
            <div className="w-20 h-20 bg-[#F3E9FF] rounded-full flex items-center justify-center mx-auto mb-4 text-[#542477]">
              <Award size={40} />
            </div>
            <h2 className="text-3xl font-extrabold text-[#27113D] mb-1">
              Mock Interview Completed!
            </h2>
            <p className="text-sm text-[#8A7A9E] mb-6">
              You completed the {finalReport.company ? <strong>{finalReport.company} </strong> : null}assessment for <strong>{finalReport.target_role}</strong>.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-lg mx-auto mb-6">
              <div className="p-4 bg-[#FAF7FD] border border-[#E4D5F3] rounded-2xl">
                <div className="text-3xl font-black text-[#542477]">{overallScore}%</div>
                <div className="text-[10px] font-bold uppercase text-[#8A7A9E] mt-1">Overall Readiness</div>
              </div>
              <div className="p-4 bg-[#FAF7FD] border border-[#E4D5F3] rounded-2xl">
                <div className="text-3xl font-black text-emerald-600">
                  {finalReport.total_answered || evaluations.length}
                </div>
                <div className="text-[10px] font-bold uppercase text-[#8A7A9E] mt-1">Questions Answered</div>
              </div>
              <div className="p-4 bg-[#FAF7FD] border border-[#E4D5F3] rounded-2xl">
                <div className={`text-2xl font-black mt-1 ${isPassing ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {isPassing ? 'READY' : 'PREPARE'}
                </div>
                <div className="text-[10px] font-bold uppercase text-[#8A7A9E] mt-1">Outcome Status</div>
              </div>
            </div>

            {/* Dimension Breakdown */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-w-2xl mx-auto pt-4 border-t border-[#E4D5F3]">
              {Object.entries(finalReport.category_scores || {}).map(([dim, score]) => (
                <div key={dim} className="p-3 rounded-xl bg-[#FAF7FD] border border-[#E4D5F3]">
                  <div className="text-[11px] text-[#8A7A9E] capitalize font-semibold">
                    {dim.replace('_', ' ')}
                  </div>
                  <div className="text-lg font-extrabold text-[#27113D]">
                    {score}%
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-center gap-3 mt-8">
              <button
                onClick={() => setPhase('setup')}
                className="px-6 py-3 bg-[#542477] hover:bg-[#431B60] text-white text-xs font-bold rounded-full transition-all flex items-center gap-2 cursor-pointer shadow-md"
              >
                <RotateCcw size={15} /> Retake Assessment
              </button>
            </div>
          </div>

          {/* Question-by-Question Review */}
          <div className="space-y-4">
            <h3 className="text-lg font-bold text-[#27113D]">
              Assessment Review & Suggested Model Answers
            </h3>
            {finalReport.questions?.map((q, qIdx) => {
              const qId = q.question_id || `q_${qIdx + 1}`;
              const answer = finalReport.answers?.[qId] || 'No answer recorded';
              const evalObj = finalReport.evaluations?.[qId] || {};

              return (
                <div key={qIdx} className="bg-white rounded-3xl border border-[#E4D5F3] p-6 shadow-xs space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[#542477]">
                      Question {qIdx + 1} • {q.section || q.category || 'Technical'}
                    </span>
                    {evalObj.overall_score !== undefined && (
                      <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-[#F3E9FF] text-[#542477]">
                        Score: {evalObj.overall_score}%
                      </span>
                    )}
                  </div>

                  <h4 className="text-sm font-bold text-[#27113D]">{q.question}</h4>

                  {/* Candidate Answer */}
                  <div className="p-3.5 rounded-2xl bg-[#FAF7FD] border border-[#E4D5F3]">
                    <div className="text-[11px] font-bold text-[#8A7A9E] uppercase mb-1">Your Submitted Response:</div>
                    <p className="text-xs font-mono text-[#27113D] whitespace-pre-wrap">{answer}</p>
                  </div>

                  {/* Reference Model Answer */}
                  {evalObj.ideal_answer && (
                    <div className="p-3.5 rounded-2xl bg-[#F0FDF4] border border-[#BBF7D0]">
                      <div className="text-[11px] font-bold text-[#166534] uppercase mb-1">Suggested Model Answer:</div>
                      <p className="text-xs text-[#166534]">{evalObj.ideal_answer}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // RENDER: ARCHIVED HISTORY VIEW
  // -------------------------------------------------------------------------
  if (phase === 'history') {
    return (
      <div className="text-[#27113D] font-sans pb-12">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setPhase('setup')}
              className="inline-flex items-center gap-2 text-xs font-bold text-[#542477] hover:underline cursor-pointer"
            >
              <ArrowLeft size={16} /> Back to Studio Setup
            </button>
            <h1 className="text-xl font-extrabold text-[#27113D]">Archived Interview Reports</h1>
          </div>

          <div className="bg-white rounded-3xl border border-[#E4D5F3] p-6 shadow-xs">
            {pastSessions.length === 0 ? (
              <div className="text-center py-12 text-[#8A7A9E] text-sm">
                No previous interview sessions found. Start a new session from the studio!
              </div>
            ) : (
              <div className="space-y-3">
                {pastSessions.map((s) => (
                  <div
                    key={s.session_id}
                    onClick={() => handleViewArchivedReport(s.session_id)}
                    className="p-4 rounded-2xl border border-[#E4D5F3] hover:border-[#542477] bg-[#FAF7FD] hover:bg-[#F3E9FF]/30 transition-all cursor-pointer flex items-center justify-between"
                  >
                    <div>
                      <div className="text-sm font-bold text-[#27113D]">
                        {s.target_role} • {s.company || 'Enterprise'}
                      </div>
                      <div className="text-xs text-[#8A7A9E] capitalize mt-0.5">
                        {s.round_type} • {s.difficulty} • {s.answers_count} questions answered
                      </div>
                    </div>
                    <div className="text-right flex items-center gap-3">
                      {s.overall_score && (
                        <span className="text-sm font-extrabold text-[#542477]">
                          {s.overall_score}%
                        </span>
                      )}
                      <ChevronRight size={18} className="text-[#8A7A9E]" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-12">
      <button
        onClick={() => setPhase('setup')}
        className="px-5 py-2.5 rounded-full bg-[#542477] text-white text-xs font-bold hover:bg-[#3E165B] transition-colors cursor-pointer"
      >
        Return to Interview Studio
      </button>
    </div>
  );
}