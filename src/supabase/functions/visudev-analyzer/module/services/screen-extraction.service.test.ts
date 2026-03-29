/**
 * Tests for React Router screen extraction (nested routes, Navigate skip, full paths).
 * Run: deno test module/services/screen-extraction.service.test.ts
 */
import { assertEquals } from "std/assert";
import type { FileContent } from "../dto/index.ts";
import { NavigationLinkExtractor } from "./navigation-link-extractor.ts";
import { PageLikeExtractor } from "./page-like-extractor.ts";
import { ScreenExtractionService } from "./screen-extraction.service.ts";
import { StateTargetExtractor } from "./state-target-extractor.ts";

const nav = new NavigationLinkExtractor();
const service = new ScreenExtractionService(
  nav,
  new StateTargetExtractor(),
  new PageLikeExtractor(nav),
);

Deno.test("extractReactRouterScreens: nested routes get full path", () => {
  const jsx = `
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Suspense fallback={null}><DashboardScreen /></Suspense>} />
        <Route path="learning/video/:videoId" element={<Suspense><VideoDetailScreen /></Suspense>} />
      </Route>
      <Route path="/admin" element={<ProtectedRoute><AdminRoute><AdminLayout /></AdminRoute>}>
        <Route path="team-und-mitarbeiterverwaltung/user/:userId" element={<Suspense><TeamMemberDetailsScreen /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  `;
  const files: FileContent[] = [{ path: "src/App.tsx", content: jsx }];
  const screens = service.extractReactRouterScreens(files);

  const paths = screens.map((s) => s.path).sort();
  assertEquals(paths.includes("/login"), true);
  assertEquals(paths.includes("/dashboard"), true);
  assertEquals(paths.includes("/learning/video/:videoId"), true);
  assertEquals(
    paths.includes("/admin/team-und-mitarbeiterverwaltung/user/:userId"),
    true,
  );
  assertEquals(
    screens.some((s) => s.name === "Navigate" || s.path === "*"),
    false,
  );
  assertEquals(screens.some((s) => s.path === "/"), false);
});

Deno.test("extractReactRouterScreens: Navigate and path=* are skipped", () => {
  const jsx = `
    <Route path="/documents" element={<Navigate to="/settings" replace />} />
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
    <Route path="/settings" element={<SettingsScreen />} />
  `;
  const files: FileContent[] = [{ path: "App.tsx", content: jsx }];
  const screens = service.extractReactRouterScreens(files);

  assertEquals(screens.some((s) => s.path === "*"), false);
  assertEquals(screens.some((s) => s.name === "Navigate"), false);
  assertEquals(screens.some((s) => s.path === "/documents"), false);
  assertEquals(screens.some((s) => s.path === "/settings"), true);
});

Deno.test("extractReactRouterScreens: layout-only routes (ProtectedRoute, MainLayout) are skipped", () => {
  const jsx = `
    <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
      <Route path="dashboard" element={<DashboardScreen />} />
    </Route>
  `;
  const files: FileContent[] = [{ path: "App.tsx", content: jsx }];
  const screens = service.extractReactRouterScreens(files);

  assertEquals(
    screens.some((s) => s.path === "/" && s.name === "ProtectedRoute"),
    false,
  );
  assertEquals(screens.some((s) => s.path === "/dashboard"), true);
});

Deno.test("extractReactRouterScreens: hrkoordinator-like structure yields many screens", () => {
  const hrLike = `
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/" element={<ProtectedRoute><MainLayout /></ProtectedRoute>}>
        <Route path="dashboard" element={<Suspense><DashboardScreen /></Suspense>} />
        <Route path="calendar" element={<Suspense><CalendarScreen /></Suspense>} />
        <Route path="learning" element={<Suspense><LearningScreen /></Suspense>} />
        <Route path="learning/video/:videoId" element={<Suspense><VideoDetailScreen /></Suspense>} />
        <Route path="settings" element={<Suspense><SettingsScreen /></Suspense>} />
        <Route path="benefits/:benefitId" element={<Suspense><BenefitDetailScreen /></Suspense>} />
      </Route>
      <Route path="/admin" element={<ProtectedRoute><AdminRoute><AdminLayout /></AdminRoute>}>
        <Route path="team-und-mitarbeiterverwaltung" element={<Suspense><TeamUndMitarbeiterverwaltung /></Suspense>} />
        <Route path="vehicle/:vehicleId" element={<Suspense><VehicleDetailScreen /></Suspense>} />
        <Route path="workflows/builder/:workflowId" element={<Suspense><WorkflowDetailScreen /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  `;
  const files: FileContent[] = [{ path: "src/App.tsx", content: hrLike }];
  const screens = service.extractReactRouterScreens(files);

  const paths = new Set(screens.map((s) => s.path));
  assertEquals(paths.has("/login"), true);
  assertEquals(paths.has("/dashboard"), true);
  assertEquals(paths.has("/admin/team-und-mitarbeiterverwaltung"), true);
  assertEquals(paths.has("/admin/vehicle/:vehicleId"), true);
  assertEquals(paths.has("/admin/workflows/builder/:workflowId"), true);
  assertEquals(paths.has("*"), false);
  assertEquals(
    screens.length >= 11,
    true,
    "hrkoordinator-like structure yields 11+ screens (public + nested under / and /admin)",
  );
});
