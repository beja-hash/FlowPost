"use client";

import { useState } from "react";
import type { ComponentType } from "react";
import Link from "next/link";
import { BarChart3, FileText, Globe2, Plus, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/saas/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { BrandListItem } from "../types";
import { BrandDialog } from "./brand-dialog";

type BrandsManagerProps = {
  initialBrands: BrandListItem[];
};

function statusLabel(status: BrandListItem["status"]) {
  if (status === "ACTIVE") {
    return "активен";
  }

  if (status === "PAUSED") {
    return "пауза";
  }

  return "архив";
}

export function BrandsManager({ initialBrands }: BrandsManagerProps) {
  const [brands, setBrands] = useState(initialBrands);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const totalAssets = brands.reduce((sum, brand) => sum + brand.assetCount, 0);
  const totalPublications = brands.reduce(
    (sum, brand) => sum + brand.publicationCount,
    0,
  );
  const activeBrands = brands.filter((brand) => brand.status === "ACTIVE").length;

  function upsertBrand(savedBrand: BrandListItem) {
    setBrands((current) => {
      const exists = current.some((brand) => brand.id === savedBrand.id);

      if (!exists) {
        return [savedBrand, ...current];
      }

      return current.map((brand) =>
        brand.id === savedBrand.id ? savedBrand : brand,
      );
    });
  }

  async function handleArchive(brandId: string) {
    setArchivingId(brandId);

    try {
      const response = await fetch(`/api/brands/${brandId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const body = (await response.json()) as { error?: { message?: string } };
        throw new Error(body.error?.message ?? "Не удалось удалить бренд.");
      }

      setBrands((current) => current.filter((brand) => brand.id !== brandId));
      toast.success("Бренд удален.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось удалить бренд.",
      );
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Контекст контента
          </p>
          <h1 className="mt-3 font-heading text-3xl font-semibold tracking-tight">
            Бренды
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Продукты и проекты, для которых создаются статьи и публикации.
          </p>
        </div>
        <Button
          size="sm"
          nativeButton={false}
          render={<Link href="/brands/new" />}
        >
          <Plus />
          Добавить бренд
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Globe2} label="Всего брендов" value={brands.length} />
        <SummaryCard icon={BarChart3} label="Активных брендов" value={activeBrands} />
        <SummaryCard icon={FileText} label="Статей" value={totalAssets} />
        <SummaryCard icon={Send} label="Публикаций" value={totalPublications} />
      </div>

      {brands.length === 0 ? (
        <Card className="min-h-[420px] justify-center rounded-[1.5rem] border-border/45 bg-card/72 py-0 ring-1 ring-white/10">
          <CardContent className="mx-auto flex max-w-xl flex-col items-center px-6 py-14 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary shadow-[0_18px_46px_-30px_color-mix(in_srgb,var(--color-primary)_70%,transparent)]">
              <Globe2 className="size-7" />
            </div>
            <h2 className="mt-6 text-xl font-semibold tracking-tight">
              Пока нет брендов
            </h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Добавьте первый бренд, чтобы начать создавать статьи и публикации под конкретный продукт.
            </p>
            <Button
              className="mt-7"
              nativeButton={false}
              render={<Link href="/brands/new" />}
            >
              <Plus />
              Добавить первый бренд
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-[1.5rem] border-border/45 bg-card/76 py-0 ring-1 ring-white/10">
          <CardContent className="p-0">
            <div className="flex items-center justify-between border-b border-border/25 px-5 py-4">
              <div>
                <p className="text-sm font-semibold">Список брендов</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {brands.length} в рабочем пространстве
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/25 hover:bg-transparent">
                    <TableHead className="h-11 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Бренд
                    </TableHead>
                    <TableHead className="h-11 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Сайт
                    </TableHead>
                    <TableHead className="h-11 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Ниша
                    </TableHead>
                    <TableHead className="h-11 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Статьи
                    </TableHead>
                    <TableHead className="h-11 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Публикации
                    </TableHead>
                    <TableHead className="h-11 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Статус
                    </TableHead>
                    <TableHead className="h-11 text-right text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      Действия
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {brands.map((brand) => (
                    <TableRow
                      key={brand.id}
                      className="border-border/20 transition-colors hover:bg-muted/35"
                    >
                      <TableCell className="min-w-[240px] py-4">
                        <div>
                          <p className="font-medium">{brand.name}</p>
                          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                            {brand.targetAudience ?? "Аудитория не указана"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {brand.domain}
                      </TableCell>
                      <TableCell>{brand.industry ?? "-"}</TableCell>
                      <TableCell>{brand.assetCount}</TableCell>
                      <TableCell>{brand.publicationCount}</TableCell>
                      <TableCell>
                        <StatusBadge tone={brand.status === "ACTIVE" ? "positive" : "neutral"}>
                          {statusLabel(brand.status)}
                        </StatusBadge>
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          <BrandDialog brand={brand} onSaved={upsertBrand} />
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => void handleArchive(brand.id)}
                            disabled={archivingId === brand.id}
                            aria-label="Удалить бренд"
                          >
                            <Trash2 />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

type SummaryCardProps = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: number;
};

function SummaryCard({ icon: Icon, label, value }: SummaryCardProps) {
  return (
    <Card className="rounded-[1.25rem] border-border/40 bg-card/70 py-0 ring-1 ring-white/10">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex size-10 items-center justify-center rounded-xl border border-border/35 bg-background/30 text-muted-foreground">
          <Icon className="size-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
