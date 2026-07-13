import React, { useState, useEffect } from "react";
import Parse from "parse";
import Alert from "../../primitives/Alert";
import Loader from "../../primitives/Loader";
import { useTranslation } from "react-i18next";


const DirectorySync = () => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ type: "", msg: "" });
  const [stats, setStats] = useState({
    totalUsers: 0,
    lastSync: null,
    syncStatus: "unknown",
  });

  const showAlert = (type, msg) => {
    setAlert({ type, msg });
    setTimeout(() => setAlert({ type: "", msg: "" }), 3000);
  };

  const fetchStats = async () => {
    try {
      setLoading(true);
      const res = await Parse.Cloud.run('getDirectoryStatistics');

      setStats({
        totalUsers: res.totalUsers,
        lastSync: res.lastSync,
        syncStatus: res.syncStatus,
      });
    } catch (err) {
      console.error(err);
      showAlert("danger", "Failed to fetch directory statistics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  const handleSync = async () => {
    try {
      setLoading(true);
      const result = await Parse.Cloud.run('syncEntraDirectory');
      if (result.status === 'failed') {
        showAlert("danger", `Sync failed: ${result.errorMessage || "Unknown error"}`);
      } else {
        showAlert("success", `Sync success. ${result.usersProcessed} users processed.`);
      }
      fetchStats();
    } catch (err) {
      console.error(err);
      showAlert("danger", err.message || "Synchronization failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 bg-base-200 min-h-screen">
      <div className="max-w-4xl mx-auto">
        {alert.msg && <Alert type={alert.type}>{alert.msg}</Alert>}
        
        <div className="bg-base-100 rounded-2xl shadow-sm p-6 mb-8">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-2xl font-bold text-base-content">Directory Synchronization</h2>
              <p className="text-sm text-gray-500 mt-1">Manage Microsoft Entra ID user synchronization</p>
            </div>
            <button 
              onClick={handleSync} 
              disabled={loading}
              className="op-btn op-btn-primary gap-2"
            >
              {loading ? <span className="loading loading-spinner loading-sm"></span> : <i className="fa-light fa-rotate"></i>}
              Sync Now
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-blue-50 p-6 rounded-xl border border-blue-100">
              <div className="text-blue-500 text-sm font-semibold mb-2">Total Users</div>
              <div className="text-3xl font-bold text-blue-900">{stats.totalUsers}</div>
            </div>
            <div className="bg-green-50 p-6 rounded-xl border border-green-100">
              <div className="text-green-600 text-sm font-semibold mb-2">Last Sync</div>
              <div className="text-lg font-bold text-green-900">
                {stats.lastSync ? new Date(stats.lastSync).toLocaleString() : "Never"}
              </div>
            </div>
            <div className={`p-6 rounded-xl border ${stats.syncStatus === 'success' ? 'bg-green-50 border-green-100' : stats.syncStatus === 'failed' ? 'bg-red-50 border-red-100' : 'bg-gray-50 border-gray-100'}`}>
              <div className="text-sm font-semibold mb-2 text-gray-600">Status</div>
              <div className="text-xl font-bold capitalize text-gray-900">
                {stats.syncStatus === 'success' ? 'Success' : stats.syncStatus === 'failed' ? 'Failed' : stats.syncStatus}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-base-100 rounded-2xl shadow-sm p-6">
          <h3 className="text-lg font-bold mb-4">Configuration</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-3 border-b border-gray-100">
              <div>
                <div className="font-semibold text-base-content">Background Sync</div>
                <div className="text-sm text-gray-500">Automatically sync users every 6 hours</div>
              </div>
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Enabled</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-gray-100">
              <div>
                <div className="font-semibold text-base-content">Delta Synchronization</div>
                <div className="text-sm text-gray-500">Only fetch changes since last successful sync</div>
              </div>
              <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">Active</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DirectorySync;
