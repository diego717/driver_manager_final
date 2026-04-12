import { HttpError } from "../lib/core.js";

const BUDGET_CREATE_MAX_JSON_BYTES = 256 * 1024;
const BUDGET_APPROVE_MAX_JSON_BYTES = 64 * 1024;

export function createBudgetsRouteHandlers({
  jsonResponse,
  corsHeaders,
  parsePositiveInt,
  normalizeOptionalString,
  normalizeRealtimeTenantId,
  requireWebWriteRole,
  readJsonOrThrowBadRequest,
  logAuditEvent,
  getClientIpForRateLimit,
  nowIso,
  normalizeBudgetCreatePayload,
  normalizeBudgetApprovePayload,
  buildBudgetPdfDownloadPath,
  buildBudgetNumber,
  loadInstallationBudgetContext,
  generateInstallationBudgetPdf,
  storeInstallationBudgetPdf,
  persistInstallationBudget,
  listInstallationBudgets,
  loadLatestInstallationBudget,
  loadLatestApprovedInstallationBudget,
  loadInstallationBudgetPdfById,
  loadInstallationBudgetById,
  approveInstallationBudget,
  updateInstallationBudgetPdfReference,
  sendBudgetEmail,
}) {
  function addBudgetDownloadPath(installationId, budget) {
    if (!budget) return null;
    return {
      ...budget,
      pdf_download_path: buildBudgetPdfDownloadPath(installationId, budget.id),
    };
  }

  async function handleInstallationBudgetsRoute(
    request,
    env,
    corsPolicy,
    routeParts,
    isWebRoute,
    webSession,
  ) {
    const isBudgetsCollectionRoute =
      routeParts.length === 3 &&
      routeParts[0] === "installations" &&
      routeParts[2] === "budgets";

    const isLatestRoute =
      routeParts.length === 4 &&
      routeParts[0] === "installations" &&
      routeParts[2] === "budgets" &&
      routeParts[3] === "latest";

    const isBudgetPdfRoute =
      routeParts.length === 5 &&
      routeParts[0] === "installations" &&
      routeParts[2] === "budgets" &&
      routeParts[4] === "pdf";

    const isBudgetApproveRoute =
      routeParts.length === 5 &&
      routeParts[0] === "installations" &&
      routeParts[2] === "budgets" &&
      routeParts[4] === "approve";

    if (
      !isBudgetsCollectionRoute &&
      !isLatestRoute &&
      !isBudgetPdfRoute &&
      !isBudgetApproveRoute
    ) {
      return null;
    }

    if (!isWebRoute) {
      throw new HttpError(405, "Ruta disponible solo en /web.");
    }

    const tenantId = normalizeRealtimeTenantId(webSession?.tenant_id);
    const installationId = parsePositiveInt(routeParts[1], "installation_id");

    if (request.method === "GET" && isBudgetsCollectionRoute) {
      const budgets = await listInstallationBudgets(env, {
        installationId,
        tenantId,
      });
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        budgets: budgets.map((item) => addBudgetDownloadPath(installationId, item)),
      });
    }

    if (request.method === "GET" && isLatestRoute) {
      const latest = await loadLatestInstallationBudget(env, installationId, tenantId);
      const latestApproved = await loadLatestApprovedInstallationBudget(
        env,
        installationId,
        tenantId,
      );
      return jsonResponse(request, env, corsPolicy, {
        success: true,
        latest_budget: addBudgetDownloadPath(installationId, latest),
        latest_approved_budget: addBudgetDownloadPath(installationId, latestApproved),
      });
    }

    if (request.method === "GET" && isBudgetPdfRoute) {
      const budgetId = parsePositiveInt(routeParts[3], "budget_id");
      const budgetPdfAsset = await loadInstallationBudgetPdfById(
        env,
        installationId,
        budgetId,
        tenantId,
      );
      if (!budgetPdfAsset?.object?.body) {
        throw new HttpError(404, "PDF de presupuesto no encontrado.");
      }

      return new Response(budgetPdfAsset.object.body, {
        status: 200,
        headers: {
          ...corsHeaders(request, env, corsPolicy),
          "Content-Type":
            budgetPdfAsset.object.httpMetadata?.contentType || "application/pdf",
          "Content-Disposition": `inline; filename="presupuesto_instalacion_${installationId}_${budgetId}.pdf"`,
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    if (request.method === "POST" && isBudgetsCollectionRoute) {
      requireWebWriteRole(webSession?.role);
      const payload = normalizeBudgetCreatePayload(
        await readJsonOrThrowBadRequest(request, "Payload invalido.", {
          maxBytes: BUDGET_CREATE_MAX_JSON_BYTES,
        }),
      );

      const actorUsername = normalizeOptionalString(webSession?.sub, "web");
      const actorUserId =
        Number.isInteger(webSession?.user_id) && Number(webSession.user_id) > 0
          ? Number(webSession.user_id)
          : null;
      const createdAt = nowIso();
      const updatedAt = createdAt;
      const requestIp = getClientIpForRateLimit(request);

      const context = await loadInstallationBudgetContext(env, {
        installationId,
        tenantId,
      });
      if (!context?.installation) {
        throw new HttpError(404, "Instalacion no encontrada.");
      }

      const budgetNumber = buildBudgetNumber(createdAt, installationId);
      const pdfBytes = await generateInstallationBudgetPdf({
        context,
        budget: {
          budgetNumber,
          incidenceSummary: payload.incidenceSummary,
          scopeIncluded: payload.scopeIncluded,
          scopeExcluded: payload.scopeExcluded,
          laborAmountCents: payload.laborAmountCents,
          partsAmountCents: payload.partsAmountCents,
          taxAmountCents: payload.taxAmountCents,
          totalAmountCents: payload.totalAmountCents,
          currencyCode: payload.currencyCode,
          estimatedDays: payload.estimatedDays,
          validUntil: payload.validUntil,
          approvalStatus: "pending",
          approvedByName: "",
          approvedByChannel: "",
          approvedAt: null,
          approvalNote: "",
        },
        createdAt,
        createdByUsername: actorUsername,
      });
      const pdfAsset = await storeInstallationBudgetPdf(env, {
        tenantId,
        installationId,
        budgetNumber,
        pdfBytes,
        createdAt,
      });

      let emailResult = { delivered: false, skipped: !payload.sendEmail, error: null };
      let deliveryStatus = "generated";
      if (payload.sendEmail && payload.emailTo) {
        try {
          emailResult = await sendBudgetEmail(env, {
            to: payload.emailTo,
            installationId,
            budgetNumber,
            pdfBytes,
            clientName: context.installation?.client_name,
            assetLabel:
              context.asset?.external_code ||
              context.asset?.serial_number ||
              context.asset?.model ||
              "",
            totalAmountCents: payload.totalAmountCents,
            currencyCode: payload.currencyCode,
            validUntil: payload.validUntil,
            incidenceSummary: payload.incidenceSummary,
          });
        } catch (error) {
          emailResult = {
            delivered: false,
            skipped: false,
            error: normalizeOptionalString(error?.message, "budget_email_failed"),
          };
        }
        deliveryStatus = emailResult?.delivered ? "emailed" : "email_failed";
      }

      const metadataJson = JSON.stringify({
        email_requested: payload.sendEmail,
        email_result: emailResult,
        asset_id: context.asset?.id ?? null,
      });

      const persistedBudget = await persistInstallationBudget(env, {
        installationId,
        tenantId,
        budgetNumber,
        incidenceSummary: payload.incidenceSummary,
        scopeIncluded: payload.scopeIncluded,
        scopeExcluded: payload.scopeExcluded,
        laborAmountCents: payload.laborAmountCents,
        partsAmountCents: payload.partsAmountCents,
        taxAmountCents: payload.taxAmountCents,
        totalAmountCents: payload.totalAmountCents,
        currencyCode: payload.currencyCode,
        estimatedDays: payload.estimatedDays,
        validUntil: payload.validUntil,
        emailTo: payload.emailTo,
        deliveryStatus,
        approvalStatus: "pending",
        approvedByName: "",
        approvedByChannel: "",
        approvedAt: null,
        approvalNote: "",
        pdfR2Key: pdfAsset.r2Key,
        metadataJson,
        createdAt,
        createdByUserId: actorUserId,
        createdByUsername: actorUsername,
        updatedAt,
      });

      await logAuditEvent(env, {
        action: "generate_installation_budget",
        username: actorUsername,
        success: true,
        tenantId,
        details: {
          budget_id: persistedBudget?.id,
          budget_number: persistedBudget?.budget_number,
          installation_id: installationId,
          total_amount_cents: payload.totalAmountCents,
          currency_code: payload.currencyCode,
          email_to: payload.emailTo,
          email_requested: payload.sendEmail,
          email_result: emailResult,
          tenant_id: tenantId,
        },
        ipAddress: requestIp,
        platform: "web",
      });

      return jsonResponse(
        request,
        env,
        corsPolicy,
        {
          success: true,
          budget: addBudgetDownloadPath(installationId, persistedBudget),
        },
        201,
      );
    }

    if (request.method === "POST" && isBudgetApproveRoute) {
      requireWebWriteRole(webSession?.role);
      const budgetId = parsePositiveInt(routeParts[3], "budget_id");
      const payload = normalizeBudgetApprovePayload(
        await readJsonOrThrowBadRequest(request, "Payload invalido.", {
          maxBytes: BUDGET_APPROVE_MAX_JSON_BYTES,
        }),
      );
      const requestIp = getClientIpForRateLimit(request);
      const actorUsername = normalizeOptionalString(webSession?.sub, "web");
      const approvedAt = nowIso();
      const updatedAt = approvedAt;

      const currentBudget = await loadInstallationBudgetById(
        env,
        installationId,
        budgetId,
        tenantId,
      );
      if (!currentBudget) {
        throw new HttpError(404, "Presupuesto no encontrado.");
      }

      let approvedBudget = await approveInstallationBudget(env, {
        installationId,
        budgetId,
        tenantId,
        approvedByName: payload.approvedByName,
        approvedByChannel: payload.approvedByChannel,
        approvalNote: payload.approvalNote,
        approvedAt,
        updatedAt,
      });
      if (!approvedBudget) {
        throw new HttpError(404, "Presupuesto no encontrado.");
      }

      const context = await loadInstallationBudgetContext(env, {
        installationId,
        tenantId,
      });
      if (context?.installation) {
        const approvedBudgetPdfBytes = await generateInstallationBudgetPdf({
          context,
          budget: {
            budgetNumber: approvedBudget.budget_number || `#${approvedBudget.id}`,
            incidenceSummary: approvedBudget.incidence_summary || "",
            scopeIncluded: approvedBudget.scope_included || "",
            scopeExcluded: approvedBudget.scope_excluded || "",
            laborAmountCents: approvedBudget.labor_amount_cents || 0,
            partsAmountCents: approvedBudget.parts_amount_cents || 0,
            taxAmountCents: approvedBudget.tax_amount_cents || 0,
            totalAmountCents: approvedBudget.total_amount_cents || 0,
            currencyCode: approvedBudget.currency_code || "UYU",
            estimatedDays:
              approvedBudget.estimated_days === null || approvedBudget.estimated_days === undefined
                ? null
                : Number(approvedBudget.estimated_days),
            validUntil: approvedBudget.valid_until || null,
            approvalStatus: approvedBudget.approval_status || "approved",
            approvedByName: approvedBudget.approved_by_name || payload.approvedByName,
            approvedByChannel: approvedBudget.approved_by_channel || payload.approvedByChannel,
            approvedAt: approvedBudget.approved_at || approvedAt,
            approvalNote: approvedBudget.approval_note || payload.approvalNote || "",
          },
          createdAt: approvedBudget.created_at || approvedAt,
          createdByUsername: normalizeOptionalString(
            approvedBudget.created_by_username,
            actorUsername,
          ) || actorUsername,
        });
        const approvedPdfAsset = await storeInstallationBudgetPdf(env, {
          tenantId,
          installationId,
          budgetNumber: approvedBudget.budget_number || `budget-${approvedBudget.id}`,
          pdfBytes: approvedBudgetPdfBytes,
          createdAt: approvedAt,
        });
        await updateInstallationBudgetPdfReference(env, {
          budgetId: approvedBudget.id,
          tenantId,
          pdfR2Key: approvedPdfAsset.r2Key,
          updatedAt,
        });
        approvedBudget = await loadInstallationBudgetById(
          env,
          installationId,
          budgetId,
          tenantId,
        );
      }

      await logAuditEvent(env, {
        action: "approve_installation_budget",
        username: actorUsername,
        success: true,
        tenantId,
        details: {
          budget_id: approvedBudget.id,
          budget_number: approvedBudget.budget_number,
          installation_id: installationId,
          approved_by_name: payload.approvedByName,
          approved_by_channel: payload.approvedByChannel,
          approved_at: approvedAt,
          tenant_id: tenantId,
        },
        ipAddress: requestIp,
        platform: "web",
      });

      return jsonResponse(request, env, corsPolicy, {
        success: true,
        budget: addBudgetDownloadPath(installationId, approvedBudget),
      });
    }

    throw new HttpError(405, "Metodo no permitido para presupuestos de instalacion.");
  }

  return {
    handleInstallationBudgetsRoute,
  };
}
