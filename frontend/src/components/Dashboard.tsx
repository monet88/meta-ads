import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Campaign, RuleConfig } from "@/types";
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
  const [config, setConfig] = useState<RuleConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [sortKey, setSortKey] = useState<string>("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  const fetchData = async () => {
    setLoading(true);
    try {
      const [campsRes, configRes, healthRes] = await Promise.all([
        apiFetch("/api/campaigns"),
        apiFetch("/api/config"),
        apiFetch("/api/health")
      ]);
      setCampaigns(campsRes.data || []);
      setConfig(configRes.data);
      setHealth(healthRes);
    } catch (e) {
      console.error("Error fetching data:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  const handleConfigSave = async () => {
    if (!config) return;
    try {
      await apiFetch("/api/config", {
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

  const sortedCampaigns = [...campaigns].sort((a, b) => {
    let aVal: any = a[sortKey as keyof Campaign];
    let bVal: any = b[sortKey as keyof Campaign];

    if (sortKey === 'spend') {
      aVal = parseFloat(a.insights?.spend || '0');
      bVal = parseFloat(b.insights?.spend || '0');
    } else if (sortKey === 'purchases') {
      aVal = a.insights?.purchases || 0;
      bVal = b.insights?.purchases || 0;
    } else if (sortKey === 'action') {
      const getActionWeight = (camp: Campaign) => {
        if (camp.status === 'ACTIVE' && (
          (parseFloat(camp.insights?.spend || '0') > (config?.pauseThreshold || 9999) && (camp.insights?.purchases || 0) === 0) ||
          (parseFloat(camp.insights?.spend || '0') > (config?.pauseThreshold2 || 9999) && (camp.insights?.purchases || 0) < 2)
        )) return 2;
        if (camp.status === 'PAUSED' && parseFloat(camp.insights?.spend || '0') < (config?.resumeThreshold || 0) && (camp.insights?.purchases || 0) > 0) return 1;
        return 0;
      };
      aVal = getActionWeight(a);
      bVal = getActionWeight(b);
    } else if (sortKey === 'name' || sortKey === 'status') {
      aVal = aVal?.toString().toLowerCase() || '';
      bVal = bVal?.toString().toLowerCase() || '';
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
            <Button onClick={fetchData} variant="outline" size="icon" disabled={loading}>
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

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
                    {campaigns.length === 0 ? (
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
                          <TableCell className="text-right">{parseFloat(camp.insights?.spend?.toString() || '0').toLocaleString('vi-VN')} ₫</TableCell>
                          <TableCell className="text-right">{camp.insights?.purchases || 0}</TableCell>
                          <TableCell className="text-right">
                            {camp.status === 'ACTIVE' && (
                              (parseFloat(camp.insights?.spend || '0') > (config?.pauseThreshold || 9999) && (camp.insights?.purchases || 0) === 0) ||
                              (parseFloat(camp.insights?.spend || '0') > (config?.pauseThreshold2 || 9999) && (camp.insights?.purchases || 0) < 2)
                            ) ? (
                              <Badge variant="destructive" className="ml-auto">Will Pause</Badge>
                            ) : camp.status === 'PAUSED' && parseFloat(camp.insights?.spend || '0') < (config?.resumeThreshold || 0) && (camp.insights?.purchases || 0) > 0 ? (
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
                {config ? (
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
                    <Button className="w-full" onClick={handleConfigSave}>
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
