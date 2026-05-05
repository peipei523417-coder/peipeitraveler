import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function PrivacyPolicy() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur-lg border-b border-border/50 shadow-sm">
        <div className="container max-w-4xl py-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(-1)}
              className="rounded-xl"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <h1 className="text-lg font-bold text-foreground">
              {t("privacyPolicy")}
            </h1>
          </div>
        </div>
      </header>

      <main className="container max-w-4xl py-8 px-6">
        <div className="prose prose-stone max-w-none">
          <h2>Privacy Policy</h2>
          <p className="text-muted-foreground">Last updated: February 2025</p>

          <h3>1. Information We Collect</h3>
          <p>We collect the following types of information:</p>
          <ul>
            <li><strong>Account Information</strong>: When you sign in with Google, we collect your email address and basic profile information.</li>
            <li><strong>Travel Data</strong>: Travel projects, itinerary content, and location information you create.</li>
            <li><strong>Usage Data</strong>: Information about how you use the app and performance data.</li>
          </ul>

          <h3>2. How We Use Your Information</h3>
          <p>We use your information to:</p>
          <ul>
            <li>Provide and maintain our services</li>
            <li>Improve user experience</li>
            <li>Provide customer support</li>
            <li>Sync your travel plans across devices</li>
          </ul>

          <h3>3. Data Storage and Security</h3>
          <p>Your data is stored on secure cloud servers. We use industry-standard encryption to protect your data.</p>

          <h3>4. Data Sharing</h3>
          <p>We do not sell your personal data. Your travel data is only visible to other users when you choose to make it "Public".</p>

          <h3>5. Your Rights</h3>
          <p>You have the right to:</p>
          <ul>
            <li>Access your personal data</li>
            <li>Correct your data</li>
            <li>Delete your account and all associated data</li>
            <li>Export your data</li>
          </ul>

          <h3>6. Account Deletion</h3>
          <p>You can delete your account at any time from the account settings in the app. Deleting your account will permanently remove all your travel projects and personal data.</p>

          <h3>7. Contact Us</h3>
          <p>If you have any questions about our privacy policy, please contact us through the app.</p>
        </div>
      </main>
    </div>
  );
}
