plugins {
    id("com.android.application")
}

repositories {
    google()
    mavenCentral()
}

android {
    namespace = "br.com.koma.smartpos.dev"
    compileSdk = 36

    defaultConfig {
        applicationId = "br.com.koma.smartpos.dev"
        minSdk = 26
        targetSdk = 36
        versionCode = 2
        versionName = "0.9.0-dev"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(project(":"))
}
