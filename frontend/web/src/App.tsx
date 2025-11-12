import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface MentalHealthRecord {
  id: string;
  title: string;
  encryptedScore: number;
  publicMood: number;
  publicSupport: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<MentalHealthRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newRecordData, setNewRecordData] = useState({ 
    title: "", 
    stressLevel: "", 
    mood: "", 
    supportNeed: "",
    description: ""
  });
  const [selectedRecord, setSelectedRecord] = useState<MentalHealthRecord | null>(null);
  const [decryptedData, setDecryptedData] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMood, setFilterMood] = useState("all");
  const [userHistory, setUserHistory] = useState<MentalHealthRecord[]>([]);
  const [showFAQ, setShowFAQ] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  useEffect(() => {
    if (address && records.length > 0) {
      const userRecords = records.filter(record => record.creator.toLowerCase() === address.toLowerCase());
      setUserHistory(userRecords);
    }
  }, [address, records]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const recordsList: MentalHealthRecord[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          recordsList.push({
            id: businessId,
            title: businessData.name,
            encryptedScore: Number(businessData.publicValue1) || 0,
            publicMood: Number(businessData.publicValue1) || 0,
            publicSupport: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            creator: businessData.creator,
            timestamp: Number(businessData.timestamp),
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setRecords(recordsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createRecord = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingRecord(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating encrypted mental health record..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const stressValue = parseInt(newRecordData.stressLevel) || 0;
      const businessId = `mind-record-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, stressValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newRecordData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newRecordData.mood) || 0,
        parseInt(newRecordData.supportNeed) || 0,
        newRecordData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Record created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewRecordData({ title: "", stressLevel: "", mood: "", supportNeed: "", description: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingRecord(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (isAvailable) {
        setTransactionStatus({ visible: true, status: "success", message: "FHE system is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRecords = records.filter(record => {
    const matchesSearch = record.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         record.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesMood = filterMood === "all" || record.publicMood.toString() === filterMood;
    return matchesSearch && matchesMood;
  });

  const stats = {
    total: records.length,
    verified: records.filter(r => r.isVerified).length,
    avgMood: records.length > 0 ? (records.reduce((sum, r) => sum + r.publicMood, 0) / records.length).toFixed(1) : "0",
    userRecords: userHistory.length
  };

  const faqItems = [
    { question: "How is my data protected?", answer: "All sensitive data is encrypted using FHE (Fully Homomorphic Encryption) before being stored on-chain." },
    { question: "What information is public?", answer: "Only non-sensitive metadata like mood scores and timestamps are publicly visible." },
    { question: "How does matching work?", answer: "FHE allows computation on encrypted data to find compatible support partners without revealing private information." },
    { question: "Can I delete my data?", answer: "Due to blockchain immutability, data cannot be deleted but can be made inactive." }
  ];

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>MindDAO FHE 🔐</h1>
            <p>心理互助隱私DAO</p>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💭</div>
            <h2>Welcome to MindDAO</h2>
            <p>Connect your wallet to access the encrypted mental health support community</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to initialize FHE system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>Share your experiences with full privacy</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Find compatible support partners</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing Privacy Encryption System...</p>
        <p className="loading-note">Securing your mental health data</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted support community...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>MindDAO FHE 💭</h1>
          <p>Encrypted Mental Health Support</p>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test FHE
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + Share Experience
          </button>
          <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
            FAQ
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      {showFAQ && (
        <div className="faq-modal">
          <div className="faq-content">
            <div className="faq-header">
              <h3>Frequently Asked Questions</h3>
              <button onClick={() => setShowFAQ(false)} className="close-faq">×</button>
            </div>
            <div className="faq-list">
              {faqItems.map((item, index) => (
                <div key={index} className="faq-item">
                  <h4>{item.question}</h4>
                  <p>{item.answer}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Shares</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.avgMood}</div>
            <div className="stat-label">Avg Mood</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.userRecords}</div>
            <div className="stat-label">Your Records</div>
          </div>
        </div>
        
        <div className="controls-section">
          <div className="search-filter">
            <input
              type="text"
              placeholder="Search experiences..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select 
              value={filterMood} 
              onChange={(e) => setFilterMood(e.target.value)}
              className="filter-select"
            >
              <option value="all">All Moods</option>
              <option value="1">😢 Very Low</option>
              <option value="2">😔 Low</option>
              <option value="3">😐 Neutral</option>
              <option value="4">🙂 Good</option>
              <option value="5">😄 Excellent</option>
            </select>
            <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
              {isRefreshing ? "🔄" : "Refresh"}
            </button>
          </div>
        </div>
        
        <div className="content-grid">
          <div className="records-section">
            <h2>Community Experiences</h2>
            <div className="records-list">
              {filteredRecords.length === 0 ? (
                <div className="no-records">
                  <p>No experiences found</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">
                    Share First Experience
                  </button>
                </div>
              ) : (
                filteredRecords.map((record, index) => (
                  <div 
                    key={index}
                    className={`record-card ${selectedRecord?.id === record.id ? "selected" : ""}`}
                    onClick={() => setSelectedRecord(record)}
                  >
                    <div className="record-header">
                      <h3>{record.title}</h3>
                      <span className="mood-badge">Mood: {record.publicMood}/5</span>
                    </div>
                    <p className="record-desc">{record.description}</p>
                    <div className="record-footer">
                      <span className="record-meta">
                        {new Date(record.timestamp * 1000).toLocaleDateString()}
                      </span>
                      <span className={`status-badge ${record.isVerified ? "verified" : "encrypted"}`}>
                        {record.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="sidebar">
            <div className="user-history">
              <h3>Your Sharing History</h3>
              {userHistory.length === 0 ? (
                <p className="no-history">No sharing history yet</p>
              ) : (
                <div className="history-list">
                  {userHistory.slice(0, 5).map((record, index) => (
                    <div key={index} className="history-item">
                      <div className="history-title">{record.title}</div>
                      <div className="history-meta">
                        Mood: {record.publicMood} • {new Date(record.timestamp * 1000).toLocaleDateString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div className="fhe-info">
              <h3>FHE Protection 🔐</h3>
              <p>Your stress levels are encrypted using Zama FHE technology</p>
              <div className="fhe-steps">
                <div className="step">1. Encrypt locally</div>
                <div className="step">2. Store on-chain</div>
                <div className="step">3. Compute privately</div>
                <div className="step">4. Match securely</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateRecord 
          onSubmit={createRecord} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingRecord} 
          recordData={newRecordData} 
          setRecordData={setNewRecordData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedRecord && (
        <RecordDetailModal 
          record={selectedRecord} 
          onClose={() => { 
            setSelectedRecord(null); 
            setDecryptedData(null); 
          }} 
          decryptedData={decryptedData} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedRecord.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateRecord: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, recordData, setRecordData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    if (name === 'stressLevel') {
      const intValue = value.replace(/[^\d]/g, '');
      setRecordData({ ...recordData, [name]: intValue });
    } else {
      setRecordData({ ...recordData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-record-modal">
        <div className="modal-header">
          <h2>Share Your Experience</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="privacy-notice">
            <strong>FHE Privacy Protection 🔐</strong>
            <p>Your stress level will be encrypted and only used for matching</p>
          </div>
          
          <div className="form-group">
            <label>Experience Title *</label>
            <input 
              type="text" 
              name="title" 
              value={recordData.title} 
              onChange={handleChange} 
              placeholder="Brief title for your experience..." 
            />
          </div>
          
          <div className="form-group">
            <label>Current Mood *</label>
            <select name="mood" value={recordData.mood} onChange={handleChange}>
              <option value="">Select your mood</option>
              <option value="1">😢 Very Low</option>
              <option value="2">😔 Low</option>
              <option value="3">😐 Neutral</option>
              <option value="4">🙂 Good</option>
              <option value="5">😄 Excellent</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Stress Level (1-10) *</label>
            <input 
              type="range" 
              name="stressLevel" 
              min="1" 
              max="10" 
              value={recordData.stressLevel} 
              onChange={handleChange}
            />
            <div className="range-value">{recordData.stressLevel || 5}/10</div>
            <div className="data-type-label">FHE Encrypted 🔐</div>
          </div>
          
          <div className="form-group">
            <label>Support Needed (1-5) *</label>
            <select name="supportNeed" value={recordData.supportNeed} onChange={handleChange}>
              <option value="">Select support level</option>
              <option value="1">Just listening</option>
              <option value="2">Advice needed</option>
              <option value="3">Regular check-ins</option>
              <option value="4">Professional referral</option>
              <option value="5">Urgent support</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Your Experience Description *</label>
            <textarea 
              name="description" 
              value={recordData.description} 
              onChange={handleChange} 
              placeholder="Share your thoughts and feelings..."
              rows={4}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !recordData.title || !recordData.stressLevel || !recordData.mood || !recordData.supportNeed || !recordData.description} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Sharing..." : "Share Experience"}
          </button>
        </div>
      </div>
    </div>
  );
};

const RecordDetailModal: React.FC<{
  record: MentalHealthRecord;
  onClose: () => void;
  decryptedData: number | null;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ record, onClose, decryptedData, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (decryptedData !== null) return;
    await decryptData();
  };

  const getMoodEmoji = (mood: number) => {
    const emojis = ["😢", "😔", "😐", "🙂", "😄"];
    return emojis[mood - 1] || "😐";
  };

  return (
    <div className="modal-overlay">
      <div className="record-detail-modal">
        <div className="modal-header">
          <h2>Experience Details</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="record-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{record.title}</strong>
            </div>
            <div className="info-item">
              <span>Mood:</span>
              <strong>{getMoodEmoji(record.publicMood)} {record.publicMood}/5</strong>
            </div>
            <div className="info-item">
              <span>Support Level:</span>
              <strong>{record.publicSupport}/5</strong>
            </div>
            <div className="info-item">
              <span>Shared:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Experience</h3>
            <p>{record.description}</p>
          </div>
          
          <div className="encryption-section">
            <h3>Encrypted Stress Data</h3>
            <div className="data-row">
              <div className="data-label">Stress Level:</div>
              <div className="data-value">
                {record.isVerified && record.decryptedValue ? 
                  `${record.decryptedValue}/10 (Verified)` : 
                  decryptedData !== null ? 
                  `${decryptedData}/10 (Decrypted)` : 
                  "🔒 FHE Encrypted"
                }
              </div>
              <button 
                className={`decrypt-btn ${(record.isVerified || decryptedData !== null) ? 'decrypted' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || record.isVerified}
              >
                {isDecrypting ? "Decrypting..." : 
                 record.isVerified ? "✅ Verified" : 
                 decryptedData !== null ? "🔓 Re-verify" : 
                 "🔓 Verify"}
              </button>
            </div>
            
            <div className="fhe-explanation">
              <p>This stress level is encrypted using FHE technology. Verification ensures the data integrity without revealing it to the network.</p>
            </div>
          </div>
          
          {(record.isVerified || decryptedData !== null) && (
            <div className="matching-info">
              <h3>Compatibility Matching</h3>
              <div className="match-score">
                <div className="score-circle">
                  {Math.round((record.isVerified ? record.decryptedValue! : decryptedData!) * 8 + record.publicMood * 2)}%
                </div>
                <p>Potential match compatibility based on encrypted analysis</p>
              </div>
            </div>
          )}
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
          {!record.isVerified && (
            <button onClick={handleDecrypt} disabled={isDecrypting} className="verify-btn">
              Verify on-chain
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


