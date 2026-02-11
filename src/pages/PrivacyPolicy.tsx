import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function PrivacyPolicy() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const isZhTW = i18n.language === "zh-TW";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
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

      {/* Content */}
      <main className="container max-w-4xl py-8 px-6">
        <div className="prose prose-stone max-w-none">
          {isZhTW ? (
            <>
              <h2>隱私權政策</h2>
              <p className="text-muted-foreground">最後更新日期：2025年2月</p>

              <h3>1. 資料收集</h3>
              <p>
                我們收集以下類型的資料：
              </p>
              <ul>
                <li><strong>帳號資訊</strong>：當您使用 Google 登入時，我們會收集您的電子郵件地址和基本個人資料。</li>
                <li><strong>旅行資料</strong>：您建立的旅行專案、行程內容、地點資訊等。</li>
                <li><strong>使用資料</strong>：應用程式使用方式和效能資料。</li>
              </ul>

              <h3>2. 資料使用</h3>
              <p>我們使用您的資料來：</p>
              <ul>
                <li>提供和維護我們的服務</li>
                <li>改善使用者體驗</li>
                <li>提供客戶支援</li>
                <li>同步您的旅行計畫到不同裝置</li>
              </ul>

              <h3>3. 資料儲存與安全</h3>
              <p>
                您的資料儲存在安全的雲端伺服器上，我們採用業界標準的加密技術來保護您的資料。
              </p>

              <h3>4. 資料分享</h3>
              <p>
                我們不會出售您的個人資料。您的旅行資料只會在您選擇「公開」設定時才會對其他使用者可見。
              </p>

              <h3>5. 您的權利</h3>
              <p>您有權：</p>
              <ul>
                <li>存取您的個人資料</li>
                <li>更正您的資料</li>
                <li>刪除您的帳號和所有相關資料</li>
                <li>匯出您的資料</li>
              </ul>

              <h3>6. 帳號刪除</h3>
              <p>
                您可以隨時在應用程式內的帳號設定中刪除您的帳號。刪除帳號將永久移除所有您的旅行專案和個人資料。
              </p>

              <h3>7. 聯絡我們</h3>
              <p>
                如果您對我們的隱私權政策有任何問題，請透過應用程式內的聯絡方式與我們聯繫。
              </p>
            </>
          ) : (
            <>
              <h2>Privacy Policy</h2>
              <p className="text-muted-foreground">Last updated: February 2025</p>

              <h3>1. Information We Collect</h3>
              <p>
                We collect the following types of information:
              </p>
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
              <p>
                Your data is stored on secure cloud servers. We use industry-standard encryption to protect your data.
              </p>

              <h3>4. Data Sharing</h3>
              <p>
                We do not sell your personal data. Your travel data is only visible to other users when you choose to make it "Public".
              </p>

              <h3>5. Your Rights</h3>
              <p>You have the right to:</p>
              <ul>
                <li>Access your personal data</li>
                <li>Correct your data</li>
                <li>Delete your account and all associated data</li>
                <li>Export your data</li>
              </ul>

              <h3>6. Account Deletion</h3>
              <p>
                You can delete your account at any time from the account settings in the app. Deleting your account will permanently remove all your travel projects and personal data.
              </p>

              <h3>7. Contact Us</h3>
              <p>
                If you have any questions about our privacy policy, please contact us through the app.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
