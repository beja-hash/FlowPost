"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
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
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Бренды</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Продукты, для которых создаются и публикуются статьи.
          </p>
        </div>
        <BrandDialog onSaved={upsertBrand} />
      </div>

      <Card className="rounded-xl border-border/70 shadow-none">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Бренд</TableHead>
                <TableHead>Сайт</TableHead>
                <TableHead>Ниша</TableHead>
                <TableHead>Статьи</TableHead>
                <TableHead>Публикации</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {brands.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                    Брендов пока нет.
                  </TableCell>
                </TableRow>
              ) : (
                brands.map((brand) => (
                  <TableRow key={brand.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{brand.name}</p>
                        <p className="line-clamp-1 text-sm text-muted-foreground">
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
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
