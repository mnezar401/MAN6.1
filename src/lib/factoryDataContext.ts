import { createClient } from '@supabase/supabase-js';
import type {
  FactoryProfile,
  ProductionLine,
  Product,
  Machine,
  ProcessStage,
  RawMaterial,
  ShiftData,
  DefectRecord,
  DowntimeEvent,
  EnergyRecord,
  ProductSize,
  MachineType,
  ProcessStep,
} from '@/types';

/**
 * MIZAN — Real Data Access Layer
 *
 * Provides typed access to factory operational data stored in Supabase.
 * The UI and AI engine continue to consume the in-memory types from
 * `@/types`; this layer is responsible for loading real customer data
 * from the database and mapping it into those same shapes.
 *
 * Demo data (src/data/factoryData.ts) remains the fallback when no real
 * factory is selected or when the database has no data for the active
 * factory. This keeps the existing UI and AI logic untouched while
 * preparing the system to operate on real data.
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// =====================================================
// Factory context
// =====================================================

export interface FactoryContext {
  id: string;
  nameAr: string;
  nameEn: string;
  industry: string;
  country: string;
  employees: number;
  shifts: number;
  powerSources: string[];
  establishedYear: number;
  isDemo: boolean;
}

const DEMO_FACTORY_CONTEXT: FactoryContext = {
  id: 'demo',
  nameAr: 'مصنع الميزان لخزانات المياه البلاستيكية',
  nameEn: 'Mizan Plastic Water Tanks Factory',
  industry: 'Plastic Water Tank Manufacturing',
  country: 'Yemen',
  employees: 95,
  shifts: 2,
  powerSources: ['ديزل', 'طاقة شمسية'],
  establishedYear: 2015,
  isDemo: true,
};

const ACTIVE_FACTORY_KEY = 'mizan.activeFactoryId';

/** Returns the currently selected factory id, or null to use the demo factory. */
export function getActiveFactoryId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_FACTORY_KEY);
  } catch {
    return null;
  }
}

export function setActiveFactoryId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_FACTORY_KEY, id);
    else localStorage.removeItem(ACTIVE_FACTORY_KEY);
  } catch {
    // ignore storage failures
  }
}

/** Loads the active factory context from the database, falling back to demo. */
export async function loadFactoryContext(): Promise<FactoryContext> {
  const activeId = getActiveFactoryId();
  if (!activeId) return DEMO_FACTORY_CONTEXT;

  const { data, error } = await supabase
    .from('factories')
    .select('id, name_ar, name_en, industry, country, employees, shifts, power_sources, established_year, is_demo')
    .eq('id', activeId)
    .maybeSingle();

  if (error || !data) return DEMO_FACTORY_CONTEXT;

  return {
    id: data.id,
    nameAr: data.name_ar,
    nameEn: data.name_en ?? '',
    industry: data.industry ?? '',
    country: data.country ?? 'Yemen',
    employees: data.employees ?? 0,
    shifts: data.shifts ?? 1,
    powerSources: data.power_sources ?? [],
    establishedYear: data.established_year ?? 0,
    isDemo: data.is_demo ?? false,
  };
}

/** Lists all factories for the factory switcher (demo + real). */
export async function listFactories(): Promise<FactoryContext[]> {
  const { data, error } = await supabase
    .from('factories')
    .select('id, name_ar, name_en, industry, country, employees, shifts, power_sources, established_year, is_demo')
    .order('created_at', { ascending: true });

  if (error || !data) return [DEMO_FACTORY_CONTEXT];

  return data.map((f) => ({
    id: f.id,
    nameAr: f.name_ar,
    nameEn: f.name_en ?? '',
    industry: f.industry ?? '',
    country: f.country ?? 'Yemen',
    employees: f.employees ?? 0,
    shifts: f.shifts ?? 1,
    powerSources: f.power_sources ?? [],
    establishedYear: f.established_year ?? 0,
    isDemo: f.is_demo ?? false,
  }));
}

// =====================================================
// Mappers: database rows -> domain types
// =====================================================

function mapProductSize(values: string[] | null): ProductSize[] {
  if (!values) return [];
  return values.filter((v): v is ProductSize =>
    ['500L', '1000L', '2000L', '3000L', '5000L'].includes(v),
  ) as ProductSize[];
}

function toFactoryProfile(ctx: FactoryContext): FactoryProfile {
  return {
    id: ctx.id,
    nameAr: ctx.nameAr,
    nameEn: ctx.nameEn,
    industry: ctx.industry,
    country: ctx.country,
    employees: ctx.employees,
    shifts: ctx.shifts,
    powerSources: ctx.powerSources,
    establishedYear: ctx.establishedYear,
  };
}

// =====================================================
// Repository: load all operational data for a factory
// =====================================================

export interface FactoryDataBundle {
  context: FactoryContext;
  profile: FactoryProfile;
  productionLines: ProductionLine[];
  products: Product[];
  machines: Machine[];
  processStages: ProcessStage[];
  rawMaterials: RawMaterial[];
  shiftData: ShiftData[];
  defectRecords: DefectRecord[];
  downtimeEvents: DowntimeEvent[];
  energyRecords: EnergyRecord[];
}

/**
 * Loads the complete operational dataset for the active factory.
 * When no factory is selected or the database returns no rows, it resolves
 * to the in-memory demo data so the app keeps working in demo mode.
 */
export async function loadFactoryData(): Promise<FactoryDataBundle> {
  const context = await loadFactoryContext();

  if (context.isDemo && context.id === 'demo') {
    return loadDemoBundle();
  }

  const bundle = await loadRealBundle(context);
  if (bundle.shiftData.length === 0 && bundle.machines.length === 0) {
    // No real data yet — fall back to demo so the UI is never empty.
    return loadDemoBundle();
  }
  return bundle;
}

async function loadRealBundle(context: FactoryContext): Promise<FactoryDataBundle> {
  const factoryId = context.id;

  const [lines, products, machines, stages, materials, shifts, defects, downtime, energy] = await Promise.all([
    supabase.from('production_lines').select('*').eq('factory_id', factoryId),
    supabase.from('products').select('*').eq('factory_id', factoryId),
    supabase.from('machines').select('*').eq('factory_id', factoryId),
    supabase.from('process_stages').select('*').eq('factory_id', factoryId).order('sort_order', { ascending: true }),
    supabase.from('raw_materials').select('*').eq('factory_id', factoryId),
    supabase.from('shift_data').select('*').eq('factory_id', factoryId).order('date', { ascending: true }),
    supabase.from('defect_records').select('*').eq('factory_id', factoryId).order('date', { ascending: false }),
    supabase.from('downtime_events').select('*').eq('factory_id', factoryId).order('date', { ascending: false }),
    supabase.from('energy_records').select('*').eq('factory_id', factoryId).order('date', { ascending: true }),
  ]);

  return {
    context,
    profile: toFactoryProfile(context),
    productionLines: (lines.data ?? []).map((r): ProductionLine => ({
      id: r.id,
      name: r.name ?? r.name_ar,
      nameAr: r.name_ar,
      products: mapProductSize(r.products),
      shiftCapacity: r.shift_capacity ?? 0,
    })),
    products: (products.data ?? []).map((r): Product => ({
      id: r.id,
      name: r.name,
      size: r.size as ProductSize,
      capacityLiters: r.capacity_liters ?? 0,
      cycleTimeMin: r.cycle_time_min ?? 0,
      materialKg: Number(r.material_kg ?? 0),
      unitCost: r.unit_cost ?? 0,
      unitPrice: r.unit_price ?? 0,
      lineId: r.line_id ?? '',
    })),
    machines: (machines.data ?? []).map((r): Machine => ({
      id: r.id,
      name: r.name,
      nameAr: r.name_ar,
      type: r.type as MachineType,
      lineId: r.line_id ?? undefined,
      status: r.status as Machine['status'],
      availability: Number(r.availability ?? 0),
      performance: Number(r.performance ?? 0),
      quality: Number(r.quality ?? 0),
      oee: Number(r.oee ?? 0),
      downtimeHours: Number(r.downtime_hours ?? 0),
      mtbfHours: Number(r.mtbf_hours ?? 0),
      mttrHours: Number(r.mttr_hours ?? 0),
      lastMaintenance: r.last_maintenance ?? '',
      nextMaintenance: r.next_maintenance ?? '',
    })),
    processStages: (stages.data ?? []).map((r): ProcessStage => ({
      id: r.id,
      step: r.step as ProcessStep,
      nameAr: r.name_ar,
      nameEn: r.name_en ?? '',
      order: r.sort_order ?? 0,
      cycleTimeMin: r.cycle_time_min ?? 0,
      yieldRate: r.yield_rate ?? 100,
    })),
    rawMaterials: (materials.data ?? []).map((r): RawMaterial => ({
      id: r.id,
      nameAr: r.name_ar,
      nameEn: r.name_en ?? '',
      unit: r.unit ?? 'كجم',
      stockKg: Number(r.stock_kg ?? 0),
      consumptionPerDayKg: Number(r.consumption_per_day_kg ?? 0),
      unitCost: r.unit_cost ?? 0,
      supplier: r.supplier ?? '',
      leadTimeDays: r.lead_time_days ?? 0,
    })),
    shiftData: (shifts.data ?? []).map((r): ShiftData => ({
      id: r.id,
      shiftName: r.shift_name,
      date: r.date,
      lineId: r.line_id,
      plannedUnits: r.planned_units ?? 0,
      actualUnits: r.actual_units ?? 0,
      goodUnits: r.good_units ?? 0,
      defectUnits: r.defect_units ?? 0,
      scrapKg: r.scrap_kg ?? 0,
      runtimeHours: Number(r.runtime_hours ?? 0),
      downtimeHours: Number(r.downtime_hours ?? 0),
      energyKwh: r.energy_kwh ?? 0,
      energyCost: r.energy_cost ?? 0,
    })),
    defectRecords: (defects.data ?? []).map((r): DefectRecord => ({
      id: r.id,
      date: r.date,
      productSize: r.product_size as ProductSize,
      defectType: r.defect_type,
      count: r.count ?? 0,
      rootCause: r.root_cause ?? undefined,
    })),
    downtimeEvents: (downtime.data ?? []).map((r): DowntimeEvent => ({
      id: r.id,
      date: r.date,
      machineId: r.machine_id,
      machineName: r.machine_name ?? '',
      reason: r.reason,
      durationMin: r.duration_min ?? 0,
      category: r.category as DowntimeEvent['category'],
    })),
    energyRecords: (energy.data ?? []).map((r): EnergyRecord => ({
      date: r.date,
      source: r.source as EnergyRecord['source'],
      kwh: r.kwh ?? 0,
      cost: r.cost ?? 0,
    })),
  };
}

async function loadDemoBundle(): Promise<FactoryDataBundle> {
  const demo = await import('@/data/factoryData');
  return {
    context: DEMO_FACTORY_CONTEXT,
    profile: toFactoryProfile(DEMO_FACTORY_CONTEXT),
    productionLines: demo.productionLines,
    products: demo.products,
    machines: demo.machines,
    processStages: demo.processStages,
    rawMaterials: demo.rawMaterials,
    shiftData: demo.shiftData,
    defectRecords: demo.defectRecords,
    downtimeEvents: demo.downtimeEvents,
    energyRecords: demo.energyRecords,
  };
}

// =====================================================
// Writes: insert real operational records
// =====================================================

export async function insertShiftRecord(factoryId: string, row: Omit<ShiftData, 'id'> & { id?: string }): Promise<boolean> {
  const id = row.id ?? `shift-${row.date}-${row.lineId}-${Date.now()}`;
  const { error } = await supabase.from('shift_data').insert({
    factory_id: factoryId,
    id,
    shift_name: row.shiftName,
    date: row.date,
    line_id: row.lineId,
    planned_units: row.plannedUnits,
    actual_units: row.actualUnits,
    good_units: row.goodUnits,
    defect_units: row.defectUnits,
    scrap_kg: row.scrapKg,
    runtime_hours: row.runtimeHours,
    downtime_hours: row.downtimeHours,
    energy_kwh: row.energyKwh,
    energy_cost: row.energyCost,
  });
  return !error;
}

export async function insertDefectRecord(factoryId: string, row: Omit<DefectRecord, 'id'> & { id?: string }): Promise<boolean> {
  const id = row.id ?? `d-${Date.now()}`;
  const { error } = await supabase.from('defect_records').insert({
    factory_id: factoryId,
    id,
    date: row.date,
    product_size: row.productSize,
    defect_type: row.defectType,
    count: row.count,
    root_cause: row.rootCause,
  });
  return !error;
}

export async function insertDowntimeEvent(factoryId: string, row: Omit<DowntimeEvent, 'id'> & { id?: string }): Promise<boolean> {
  const id = row.id ?? `dt-${Date.now()}`;
  const { error } = await supabase.from('downtime_events').insert({
    factory_id: factoryId,
    id,
    date: row.date,
    machine_id: row.machineId,
    machine_name: row.machineName,
    reason: row.reason,
    duration_min: row.durationMin,
    category: row.category,
  });
  return !error;
}

export async function insertEnergyRecord(factoryId: string, date: string, source: EnergyRecord['source'], kwh: number, cost: number): Promise<boolean> {
  const id = `en-${date}-${source}-${Date.now()}`;
  const { error } = await supabase.from('energy_records').insert({
    factory_id: factoryId,
    id,
    date,
    source,
    kwh,
    cost,
  });
  return !error;
}

// =====================================================
// Factory management: create a real customer factory
// =====================================================

export async function createRealFactory(input: {
  nameAr: string;
  nameEn?: string;
  industry?: string;
  country?: string;
  employees?: number;
  shifts?: number;
  powerSources?: string[];
  establishedYear?: number;
}): Promise<FactoryContext | null> {
  const { data, error } = await supabase
    .from('factories')
    .insert({
      name_ar: input.nameAr,
      name_en: input.nameEn,
      industry: input.industry,
      country: input.country ?? 'Yemen',
      employees: input.employees ?? 0,
      shifts: input.shifts ?? 1,
      power_sources: input.powerSources ?? [],
      established_year: input.establishedYear,
      is_demo: false,
    })
    .select('id, name_ar, name_en, industry, country, employees, shifts, power_sources, established_year, is_demo')
    .single();

  if (error || !data) return null;

  return {
    id: data.id,
    nameAr: data.name_ar,
    nameEn: data.name_en ?? '',
    industry: data.industry ?? '',
    country: data.country ?? 'Yemen',
    employees: data.employees ?? 0,
    shifts: data.shifts ?? 1,
    powerSources: data.power_sources ?? [],
    establishedYear: data.established_year ?? 0,
    isDemo: false,
  };
}
