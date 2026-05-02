import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AdAccount, ApiSuccessResponse, Campaign, RuleConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Activity, Settings, RefreshCw, AlertCircle, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export default function Dashboard() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [adAccounts, setAdAccounts] = useState<AdAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [config, setConfig] = useState<RuleConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [health, setHealth] = useState<{ status?: string } | null>(null);
  const [sortKey, setSortKey] = useState<string>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const fetchAccounts = async () => {
    setAccountsLoading(true);
    try {
      const [accountsRes, healthRes] = await Promise.all([
        apiFetch<ApiSuccessResponse<AdAccount[]>>("/api/ad-accounts"),
        apiFetch<ApiSuccessResponse<{ status?: string }>>("/api/health")
      ]);
      setAdAccounts(accountsRes.data || []);
      setHealth(healthRes.data);
    } catch (e) {
      console.error("Error fetching accounts:", e);
    } finally {
      setAccountsLoading(false);
    }
  };

  const fetchData = async () => {
    if (!selectedAccountId) {
      setCampaigns([]);
      setConfig(null);
      return;
    }

    setLoading(true);
    try {
      const accountQuery = `accountId=${encodeURIComponent(selectedAccountId)}`;
      const [campsRes, configRes, logsRes] = await Promise.all([
        apiFetch<ApiSuccessResponse<Campaign[]>>(`/api/campaigns?${accountQuery}`),
        apiFetch<ApiSuccessResponse<RuleConfig>>(`/api/config?${accountQuery}`),
        apiFetch(`/api/logs?${accountQuery}`)
      ]);
      void logsRes;
      setCampaigns(campsRes.data || []);
      setConfig(configRes.data);
    } catch (e) {
      console.error("Error fetching data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000);
    return () => clearInterval(interval);
  }, [selectedAccountId]);

  const handleConfigSave = async () => {
    if (!config || !selectedAccountId) return;
    try {
      const accountQuery = `accountId=${encodeURIComponent(selectedAccountId)}`;
      await apiFetch(`/api/config?${accountQuery}`, {
        method: "PUT",
        body: JSON.stringify(config)
      });
      alert("Configuration saved successfully!");
    } catch (e) {
      alert("Failed to save configuration.");
    }
  };

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortOrder("asc");
    }
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortKey !== columnKey) return <ArrowUpDown className="ml-2 h-4 w-4 inline-block text-slate-400" />;
    return sortOrder === "asc" ? <ArrowUp className="ml-2 h-4 w-4 inline-block" /> : <ArrowDown className="ml-2 h-4 w-4 inline-block" />;
  };

  const getSpend = (campaign: Campaign) => campaign.insights?.spend ?? 0;
  const getPurchases = (campaign: Campaign) => campaign.insights?.purchases ?? 0;

  const getActionWeight = (campaign: Campaign) => {
    const spend = getSpend(campaign);
    const purchases = getPurchases(campaign);

    if (campaign.status === 'ACTIVE' && (
      (spend > (config?.pauseThreshold ?? 9999) && purchases === 0) ||
      (spend > (config?.pauseThreshold2 ?? 9999) && purchases < 2)
    )) return 2;
    if (campaign.status === 'PAUSED' && spend < (config?.resumeThreshold ?? 0) && purchases > 0) return 1;
    return 0;
  };

  const shouldPause = (campaign: Campaign) => getActionWeight(campaign) === 2;
  const shouldResume = (campaign: Campaign) => getActionWeight(campaign) === 1;

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    let aVal: string | number = a[sortKey as keyof Campaign]?.toString().toLowerCase() || '';
    let bVal: string | number = b[sortKey as keyof Campaign]?.toString().toLowerCase() || '';

    if (sortKey === 'spend') {
      aVal = getSpend(a);
      bVal = getSpend(b);
    } else if (sortKey === 'purchases') {
      aVal = getPurchases(a);
      bVal = getPurchases(b);
    } else if (sortKey === 'action') {
      aVal = getActionWeight(a);
      bVal = getActionWeight(b);
    }

    if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
    if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
    return 0;
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-8">
      <div className="w-full space-y-8">
        
        {/* Header Section */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">Meta Ads Automation</h1>
            <p className="text-slate-500 mt-2">Manage your automated pausing and resuming rules based on today's spend.</p>
          </div>
          <div className="flex items-center space-x-4">
            {health?.status === 'ok' ? (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <Activity className="w-4 h-4 mr-1" /> API Connected
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                <AlertCircle className="w-4 h-4 mr-1" /> API Disconnected
              </Badge>
            )}
            <Button onClick={fetchData} variant="outline" size="icon" disabled={loading || !selectedAccountId}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Ad Account</CardTitle>
            <CardDescription>Select an account before loading campaigns and rules.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="ad-account">Account</Label>
            <select
              id="ad-account"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={selectedAccountId}
              onChange={(event) => setSelectedAccountId(event.target.value)}
              disabled={accountsLoading}
            >
              <option value="">{accountsLoading ? "Loading accounts..." : "Chọn account trước"}</option>
              {adAccounts.map((account) => (
                <option key={account.id} value={account.account_id}>
                  {account.name} ({account.account_id})
                </option>
              ))}
            </select>
            {!selectedAccountId && <p className="text-sm text-slate-500">Chọn account trước.</p>}
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Main Content: Campaigns */}
          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Active Campaigns</CardTitle>
                <CardDescription>Today's performance and automation status.</CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => handleSort('name')}>
                        <div className="flex items-center">Campaign <SortIcon columnKey="name" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => handleSort('status')}>
                        <div className="flex items-center">Status <SortIcon columnKey="status" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => handleSort('spend')}>
                        <div className="flex items-center justify-end">Spend <SortIcon columnKey="spend" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => handleSort('purchases')}>
                        <div className="flex items-center justify-end">Purchases <SortIcon columnKey="purchases" /></div>
                      </TableHead>
                      <TableHead className="cursor-pointer select-none hover:bg-slate-100 transition-colors" onClick={() => handleSort('action')}>
                        <div className="flex items-center justify-end">Action <SortIcon columnKey="action" /></div>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {!selectedAccountId ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                          Chọn account trước.
                        </TableCell>
                      </TableRow>
                    ) : campaigns.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                          No campaigns found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedCampaigns.map((camp) => (
                        <TableRow key={camp.id}>
                          <TableCell className="font-medium max-w-[250px] truncate" title={camp.name}>
                            {camp.name}
                          </TableCell>
                          <TableCell>
                            <Badge variant={camp.status === 'ACTIVE' ? 'default' : 'secondary'}>
                              {camp.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">{getSpend(camp).toLocaleString('vi-VN')} ₫</TableCell>
                          <TableCell className="text-right">{getPurchases(camp)}</TableCell>
                          <TableCell className="text-right">
                            {shouldPause(camp) ? (
                              <Badge variant="destructive" className="ml-auto">Will Pause</Badge>
                            ) : shouldResume(camp) ? (
                              <Badge className="bg-green-500 ml-auto">Will Resume</Badge>
                            ) : (
                              <span className="text-slate-400 text-sm">Monitoring</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {/* Sidebar: Configuration */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center">
                  <Settings className="w-5 h-5 mr-2" />
                  Automation Rules
                </CardTitle>
                <CardDescription>Configure thresholds for pausing and resuming.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {!selectedAccountId ? (
                  <p className="text-sm text-slate-500">Chọn account trước.</p>
                ) : config ? (
                  <>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="enabled" className="text-base font-medium">Enable Automation</Label>
                      <Switch
                        id="enabled"
                        checked={config.enabled}
                        onCheckedChange={(c) => setConfig({ ...config, enabled: c })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pause">Pause Threshold 1 (₫)</Label>
                      <p className="text-xs text-slate-500">Pause if spend &gt; X and 0 purchases.</p>
                      <Input
                        id="pause"
                        type="number"
                        value={config.pauseThreshold}
                        onChange={(e) => setConfig({ ...config, pauseThreshold: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pause2">Pause Threshold 2 (₫)</Label>
                      <p className="text-xs text-slate-500">Pause if spend &gt; X and &lt; 2 purchases.</p>
                      <Input
                        id="pause2"
                        type="number"
                        value={config.pauseThreshold2 ?? 200000}
                        onChange={(e) => setConfig({ ...config, pauseThreshold2: Number(e.target.value) })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="resume">Resume Threshold (₫)</Label>
                      <p className="text-xs text-slate-500">Resume if spend &lt; X and &gt; 0 purchases.</p>
                      <Input
                        id="resume"
                        type="number"
                        value={config.resumeThreshold}
                        onChange={(e) => setConfig({ ...config, resumeThreshold: Number(e.target.value) })}
                      />
                    </div>
                    <Button className="w-full" onClick={handleConfigSave} disabled={!selectedAccountId}>
                      Save Configuration
                    </Button>
                  </>
                ) : (
                  <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-slate-200 rounded w-full"></div>
                    <div className="h-10 bg-slate-200 rounded w-full"></div>
                    <div className="h-10 bg-slate-200 rounded w-full"></div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Quick Actions / Info */}
            <Card className="bg-slate-900 text-slate-50">
              <CardHeader>
                <CardTitle className="text-lg">How it works</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-300 space-y-4">
                <p>
                  The background worker checks your campaigns every 30 minutes.
                </p>
                <ul className="list-disc pl-4 space-y-2">
                  <li>If an active campaign exceeds Threshold 1 (no purchases) or Threshold 2 (&lt; 2 purchases), it will be automatically paused.</li>
                  <li>If a paused campaign receives late attributed purchases keeping the CPA below the resume threshold, it will be resumed.</li>
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
