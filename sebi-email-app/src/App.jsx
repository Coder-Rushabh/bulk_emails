import React, { useState, useEffect, useMemo } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import axios from 'axios';
import { Mail, CheckCircle, Clock, Search, Edit3, Send, RefreshCw, Settings, FileSpreadsheet, User } from 'lucide-react';

const DAILY_LIMIT = 100;
const API_URL = 'http://localhost:5000';

function App() {
  const [advisors, setAdvisors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataFileName, setDataFileName] = useState('Default (data.csv)');
  const [statuses, setStatuses] = useState(() => {
    const saved = localStorage.getItem('advisor_statuses');
    return saved ? JSON.parse(saved) : {};
  });
  const [template, setTemplate] = useState(() => {
    return localStorage.getItem('email_template') || "Hello {Name},\n\nI noticed you are a SEBI registered advisor (Reg No: {RegNo}). I would like to connect...\n\nBest regards,\n[Your Name]";
  });
  const [senderConfig, setSenderConfig] = useState(() => {
    const saved = localStorage.getItem('sender_config');
    return saved ? JSON.parse(saved) : {
      email: '',
      password: '',
      smtp_server: 'smtp.gmail.com',
      smtp_port: 587
    };
  });
  
  const [searchTerm, setSearchTerm] = useState('');
  const [view, setView] = useState('daily'); // 'daily', 'all', 'template', 'settings'

  useEffect(() => {
    // Try to load default data if it exists
    fetch('/data.csv')
      .then(res => {
        if (res.ok) return res.text();
        throw new Error('Not found');
      })
      .then(csvData => {
        Papa.parse(csvData, {
          header: true,
          complete: (results) => {
            const data = results.data.filter(a => a.Name && a['E-mail']);
            setAdvisors(data);
            setLoading(false);
          }
        });
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    localStorage.setItem('advisor_statuses', JSON.stringify(statuses));
  }, [statuses]);

  useEffect(() => {
    localStorage.setItem('email_template', template);
  }, [template]);

  useEffect(() => {
    localStorage.setItem('sender_config', JSON.stringify(senderConfig));
  }, [senderConfig]);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setDataFileName(file.name);
    const reader = new FileReader();
    
    if (file.name.endsWith('.csv')) {
      reader.onload = (evt) => {
        const text = evt.target.result;
        Papa.parse(text, {
          header: true,
          complete: (results) => {
            setAdvisors(results.data.filter(a => a.Name && a['E-mail']));
          }
        });
      };
      reader.readAsText(file);
    } else {
      reader.onload = (evt) => {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet);
        setAdvisors(json.filter(a => a.Name && a['E-mail']));
      };
      reader.readAsArrayBuffer(file);
    }
  };

  const dailyBatch = useMemo(() => {
    if (advisors.length === 0) return [];
    const today = new Date().toDateString();
    const dateHash = today.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const startIndex = (dateHash * DAILY_LIMIT) % advisors.length;
    return advisors.slice(startIndex, startIndex + DAILY_LIMIT);
  }, [advisors]);

  const filteredAdvisors = useMemo(() => {
    return advisors.filter(a => 
      a.Name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      a['E-mail']?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [advisors, searchTerm]);

  const updateStatus = (email, newStatus) => {
    setStatuses(prev => ({ ...prev, [email]: newStatus }));
  };

  const handleSend = async (advisor) => {
    const name = advisor.Name;
    const email = advisor['E-mail'];
    const regNo = advisor['Registration No.'];
    
    const body = template
      .replace(/{Name}/g, name)
      .replace(/{RegNo}/g, regNo);
    
    if (senderConfig.email && senderConfig.password) {
      // Use Backend API
      updateStatus(email, 'Sending...');
      try {
        await axios.post(`${API_URL}/send-email`, {
          to: email,
          subject: 'Connection Request',
          body: body,
          sender_email: senderConfig.email,
          sender_password: senderConfig.password,
          smtp_server: senderConfig.smtp_server,
          smtp_port: senderConfig.smtp_port
        });
        updateStatus(email, 'Sent');
      } catch (error) {
        console.error('Failed to send email:', error);
        updateStatus(email, 'Error');
        alert('Failed to send email. Check backend server and credentials.');
      }
    } else {
      // Fallback to mailto if no config
      const mailtoUrl = `mailto:${email}?subject=Connection Request&body=${encodeURIComponent(body)}`;
      window.location.href = mailtoUrl;
      updateStatus(email, 'Sent');
    }
  };

  if (loading) return <div className="app-container">Loading data...</div>;

  const stats = {
    total: advisors.length,
    sentToday: dailyBatch.filter(a => statuses[a['E-mail']] === 'Sent').length,
    pendingToday: dailyBatch.filter(a => !statuses[a['E-mail']] || statuses[a['E-mail']] === 'Pending').length
  };

  return (
    <div className="app-container">
      <header>
        <div className="title-group">
          <h1>AdvisorConnect Pro</h1>
          <p>Automate your SEBI advisor outreach</p>
        </div>
        <div className="tab-nav">
          <button className={`tab-btn ${view === 'daily' ? 'active' : ''}`} onClick={() => setView('daily')}>Daily Batch</button>
          <button className={`tab-btn ${view === 'all' ? 'active' : ''}`} onClick={() => setView('all')}>All Advisors</button>
          <button className={`tab-btn ${view === 'template' ? 'active' : ''}`} onClick={() => setView('template')}>Template</button>
          <button className={`tab-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}><Settings size={18} /></button>
        </div>
      </header>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Advisors</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Sent Today</span>
          <span className="stat-value" style={{color: 'var(--success)'}}>{stats.sentToday} / {DAILY_LIMIT}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Data Source</span>
          <span className="stat-value" style={{fontSize: '0.9rem', color: 'var(--primary)'}} title={dataFileName}>{dataFileName.length > 20 ? dataFileName.substring(0, 17) + '...' : dataFileName}</span>
        </div>
      </div>

      {view === 'settings' && (
        <div className="settings-panel" style={{animation: 'fadeIn 0.3s ease'}}>
          <h2 className="section-title"><Settings size={20} /> Settings</h2>
          
          <div className="settings-section">
            <h3><FileSpreadsheet size={18} /> User Data Source</h3>
            <p>Upload an Excel (.xlsx) or CSV file containing advisor data.</p>
            <input type="file" accept=".xlsx, .xls, .csv" onChange={handleFileUpload} className="file-input" />
          </div>

          <div className="settings-section">
            <h3><User size={18} /> Email Account (Sender)</h3>
            <p>Configure the email account used to send outreach messages.</p>
            <div className="input-group">
              <label>Email Address</label>
              <input 
                type="email" 
                value={senderConfig.email} 
                onChange={(e) => setSenderConfig({...senderConfig, email: e.target.value})}
                placeholder="e.g. yourname@gmail.com"
              />
            </div>
            <div className="input-group">
              <label>App Password / Password</label>
              <input 
                type="password" 
                value={senderConfig.password} 
                onChange={(e) => setSenderConfig({...senderConfig, password: e.target.value})}
                placeholder="Enter password or app password"
              />
            </div>
            <div style={{display: 'flex', gap: '1rem'}}>
              <div className="input-group" style={{flex: 2}}>
                <label>SMTP Server</label>
                <input 
                  type="text" 
                  value={senderConfig.smtp_server} 
                  onChange={(e) => setSenderConfig({...senderConfig, smtp_server: e.target.value})}
                />
              </div>
              <div className="input-group" style={{flex: 1}}>
                <label>Port</label>
                <input 
                  type="number" 
                  value={senderConfig.smtp_port} 
                  onChange={(e) => setSenderConfig({...senderConfig, smtp_port: parseInt(e.target.value)})}
                />
              </div>
            </div>
          </div>
          <button className="action-btn" onClick={() => setView('daily')}>Save & Close</button>
        </div>
      )}

      {view === 'template' && (
        <div className="template-editor" style={{animation: 'fadeIn 0.3s ease'}}>
          <h2 className="section-title"><Edit3 size={20} /> Email Template</h2>
          <p style={{color: 'var(--text-muted)', marginBottom: '1rem'}}>Use placeholders: {"{Name}"}, {"{RegNo}"}</p>
          <textarea 
            value={template} 
            onChange={(e) => setTemplate(e.target.value)}
            placeholder="Write your template here..."
          />
          <button className="action-btn" onClick={() => setView('daily')}>Save & Return</button>
        </div>
      )}

      {(view === 'daily' || view === 'all') && (
        <div className="content-section" style={{animation: 'fadeIn 0.3s ease'}}>
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
            <h2 className="section-title">
              {view === 'daily' ? <Clock size={24} /> : <Search size={24} />}
              {view === 'daily' ? "Today's Outreach Batch" : "Search All Advisors"}
            </h2>
            {view === 'all' && (
              <input 
                type="text" 
                placeholder="Search name or email..." 
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{padding: '0.5rem 1rem', borderRadius: '0.5rem', border: '1px solid var(--border)', background: 'var(--bg-card)', color: '#fff'}}
              />
            )}
          </div>

          <div className="advisor-list">
            {advisors.length === 0 ? (
              <div style={{textAlign: 'center', padding: '3rem', color: 'var(--text-muted)'}}>
                No data loaded. Go to <span style={{color: 'var(--primary)', cursor: 'pointer'}} onClick={() => setView('settings')}>Settings</span> to upload an Excel/CSV file.
              </div>
            ) : (view === 'daily' ? dailyBatch : filteredAdvisors.slice(0, 50)).map((advisor, i) => {
              const status = statuses[advisor['E-mail']] || 'Pending';
              return (
                <div key={i} className="advisor-row">
                  <div className="advisor-info">
                    <span className="name">{advisor.Name}</span>
                    <span className="reg">{advisor['Registration No.']}</span>
                  </div>
                  <div className="email-cell">{advisor['E-mail']}</div>
                  <div>
                    <span className={`status-badge status-${status.toLowerCase().replace('...', '').replace(' ', '')}`}>
                      {status === 'Sent' ? <CheckCircle size={14} /> : <Clock size={14} />}
                      {status}
                    </span>
                  </div>
                  <div style={{textAlign: 'right'}}>
                    <button className="action-btn" onClick={() => handleSend(advisor)} disabled={status === 'Sending...'}>
                      <Send size={16} /> Send
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
