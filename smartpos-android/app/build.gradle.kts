plugins {
    id("com.android.application")
}

repositories {
    google()
    mavenCentral()
    exclusiveContent {
        forRepository { maven("https://raw.githubusercontent.com/pagseguro/PlugPagServiceWrapper/master") }
        filter { includeGroup("br.com.uol.pagseguro.plugpagservice.wrapper") }
    }
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
        versionCode = 7
        versionName = "0.4.0"
        buildConfigField("String", "KOMA_API_URL", "\"$productionApi\"")
    }

    flavorDimensions += "distribution"
    productFlavors {
        create("phone") {
            dimension = "distribution"
            buildConfigField("boolean", "PAGBANK_TERMINAL", "false")
        }
        create("pagbank") {
            dimension = "distribution"
            applicationId = "br.com.koma.smartpos.pagbank"
            buildConfigField("boolean", "PAGBANK_TERMINAL", "true")
        }
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
    add("pagbankImplementation", "br.com.uol.pagseguro.plugpagservice.wrapper:wrapper:1.35.0")
    // The vendor POM has no transitive dependencies; its FileProvider needs AndroidX Core.
    add("pagbankImplementation", "androidx.core:core:1.13.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20250517")
}
