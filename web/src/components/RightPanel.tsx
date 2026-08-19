import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { LayersPanel } from "./panels/LayersPanel";
import { SettlementTable } from "./panels/SettlementTable";
import { SimPanel } from "./panels/SimPanel";
import { DataPanel } from "./panels/DataPanel";
import { Separator } from "./ui/separator";

export function RightPanel() {
  const [tab, setTab] = useState("layers");

  return (
    <aside className="flex w-[360px] shrink-0 flex-col border-l border-line bg-panel">
      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList>
          <TabsTrigger value="layers">Layers</TabsTrigger>
          <TabsTrigger value="priority">Priority</TabsTrigger>
          <TabsTrigger value="simulate">Simulate</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="layers" className="overflow-y-auto">
          <LayersPanel />
        </TabsContent>
        <TabsContent value="priority" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
          <SettlementTable />
        </TabsContent>
        <TabsContent value="simulate">
          <SimPanel />
        </TabsContent>
        <TabsContent value="data" className="overflow-y-auto">
          <DataPanel />
        </TabsContent>
      </Tabs>
      <Separator />
      <div className="px-3 py-2 font-mono text-[10px] text-ink-faint">
        reach-ops · phase 3 · operational dashboard
      </div>
    </aside>
  );
}
