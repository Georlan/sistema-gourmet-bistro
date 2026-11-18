plugins {
    id("com.android.application")
}

repositories {
    google()
    mavenCentral()
}

val productionApi = "https://sistema-gourmet-bistro-production.up.railway.app"
val debugApi = providers.gradleProperty("komaApiUrl").orElse(productionApi)
    .map { url ->
        require(url.startsWith("https://") || url.startsWith("http://"))
        require(url.none { it.isWhitespace() || it == '"' || it == '\\' })
        url.trimEnd('/')
    }

android {
    namespace = "br.com.koma.smartpos.dev"
    compileSdk = 36
    buildFeatures.buildConfig = true

    defaultConfig {
        applicationId = "br.com.koma.smartpos.dev"
        minSdk = 25
        targetSdk = 36
        versionCode = 4
        versionName = "0.2.0"
        buildConfigField("String", "KOMA_API_URL", "\"$productionApi\"")
    }

    buildTypes {
        debug {
            buildConfigField("String", "KOMA_API_URL", "\"${debugApi.get()}\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
