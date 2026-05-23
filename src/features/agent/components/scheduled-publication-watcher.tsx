"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { wakeAgentForScheduledPublication } from "@/features/agent/client/agent-wake";

export const schedulerWakeStatusEventName = "flowpost:scheduler-wake-status";

export type ScheduledPublicationWakeStatus = {
  publicationId: string;
  articleId: string;
  phase: "starting" | "success" | "failed" | "locked";
  message: string;
};

type ScheduledPublicationItem = {
  publicationId: string;
  articleId: string;
  title: string;
  platform: string;
  scheduledAt: string;
  secondsUntilPublish: number;
  status: "SCHEDULED";
};

function announceStatus(status: ScheduledPublicationWakeStatus) {
  window.dispatchEvent(
    new CustomEvent<ScheduledPublicationWakeStatus>(schedulerWakeStatusEventName, {
      detail: status,
    }),
  );
}

export function ScheduledPublicationWatcher() {
  const requestInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function checkUpcomingPublications() {
      if (requestInFlight.current) {
        return;
      }

      requestInFlight.current = true;
      try {
        const response = await fetch("/api/articles/scheduled/next", {
          cache: "no-store",
        });
        const body = (await response.json().catch(() => ({}))) as {
          items?: ScheduledPublicationItem[];
        };
        const publication = body.items?.[0];

        if (!response.ok || cancelled || !publication) {
          return;
        }

        console.info("[Scheduler Wake] nearest scheduled publication", publication);
        console.info("[Scheduler Wake] secondsUntilPublish", {
          publicationId: publication.publicationId,
          secondsUntilPublish: publication.secondsUntilPublish,
        });

        const result = await wakeAgentForScheduledPublication(
          publication.publicationId,
          {
            onStatus: (message) => {
              const failed = message.startsWith("Не удалось");
              const status = {
                publicationId: publication.publicationId,
                articleId: publication.articleId,
                phase: failed ? ("failed" as const) : ("starting" as const),
                message,
              };
              announceStatus(status);
              if (failed) {
                toast.error(message, {
                  id: `scheduler-wake:${publication.publicationId}`,
                });
              } else {
                toast.info(message, {
                  id: `scheduler-wake:${publication.publicationId}`,
                });
              }
            },
          },
        );

        if (cancelled || result.status === "locked") {
          return;
        }

        if (result.status === "success") {
          const message = "Agent запущен. Публикация выполняется автоматически.";
          announceStatus({
            publicationId: publication.publicationId,
            articleId: publication.articleId,
            phase: "success",
            message,
          });
          toast.success(message, {
            id: `scheduler-wake:${publication.publicationId}`,
          });
        }
      } catch (error) {
        console.error("[Scheduler Wake] watcher failed", error);
      } finally {
        requestInFlight.current = false;
      }
    }

    void checkUpcomingPublications();
    const timer = window.setInterval(() => void checkUpcomingPublications(), 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}
